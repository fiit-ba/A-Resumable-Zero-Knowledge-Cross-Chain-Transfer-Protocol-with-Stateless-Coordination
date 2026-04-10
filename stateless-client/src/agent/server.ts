import express, { type Request, type Response, type NextFunction } from "express";
import { createJob, getJob, getJobByTxId, listJobs } from "./db.js";
import {
  confirmJob,
  getStageDetails,
  prepareJobStage,
  recordReceipt,
  recoverJob,
  refreshJob,
  updateJobSettings,
} from "./services/job-service.js";
import { parseSchemeUrl } from "./scheme.js";
import type { RelayProofStage } from "./contracts.js";
import type {
  CreateJobBody,
  PrepareStageBody,
  ReceiptBody,
  RecoverJobBody,
  UpdateSettingsBody,
} from "./types.js";

const AGENT_VERSION = "0.1.0";

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5173", // Vite dev
  "http://localhost:4173", // Vite preview
];

const VALID_STAGES: RelayProofStage[] = [
  "lock",
  "mint",
  "ack",
  "refund-initiate",
  "refund-claim",
  "execute-burn",
  "burn-proof",
];

const VALID_STAGE_SET = new Set<RelayProofStage>(VALID_STAGES);

function parseRelayStage(value: string): RelayProofStage | null {
  return VALID_STAGE_SET.has(value as RelayProofStage) ? (value as RelayProofStage) : null;
}

function buildCorsMiddleware(allowedOriginsEnv?: string) {
  const allowed = new Set<string>([
    ...DEFAULT_ALLOWED_ORIGINS,
    ...(allowedOriginsEnv ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ]);

  return function cors(req: Request, res: Response, next: NextFunction): void {
    const origin = req.headers["origin"];
    if (origin && allowed.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
    } else if (origin && !allowed.has(origin)) {
      res.status(403).json({ error: "Origin not allowed" });
      return;
    }

    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  };
}

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

export function createApp(opts?: { allowedOrigins?: string }): express.Express {
  const app = express();
  app.use(express.json());
  app.use(buildCorsMiddleware(opts?.allowedOrigins));

  // ── Health ──────────────────────────────────────────────────────────────
  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      ok: true,
      version: AGENT_VERSION,
      pid: process.pid,
    });
  });

  // ── Jobs ────────────────────────────────────────────────────────────────

  /**
   * POST /jobs — register a transfer job.
   * Creates the job in awaiting_confirmation state.
   * Does NOT start proof computation — the browser must POST /jobs/:id/confirm.
   */
  app.post("/jobs", (req: Request, res: Response): void => {
    const body = req.body as Partial<CreateJobBody>;
    const { txId, intent } = body;

    if (!txId || !intent) {
      res.status(400).json({ error: "txId and intent are required" });
      return;
    }

    // Resume existing job for the same txId
    const existing = getJobByTxId(txId);
    if (existing) {
      res.status(200).json(existing);
      return;
    }

    const job = createJob(intent, txId);
    res.status(201).json(job);
  });

  /** GET /jobs — list all jobs */
  app.get("/jobs", (_req: Request, res: Response) => {
    res.json(listJobs());
  });

  /** GET /jobs/:id — current job state */
  app.get("/jobs/:id", (req: Request, res: Response): void => {
    const job = getJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    res.json(job);
  });

  /**
   * POST /jobs/:id/confirm — start verified stage preparation.
   * Moves the job from awaiting_confirmation → preparing_stage.
   * Returns 202 immediately; poll GET /jobs/:id for status updates.
   */
  app.post("/jobs/:id/confirm", (req: Request, res: Response): void => {
    const job = getJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    confirmJob(job.id).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[server] confirmJob error for ${job.id}: ${message}`);
    });

    // Return current state — client polls for updates
    res.status(202).json(getJob(job.id));
  });

  /**
   * PATCH /jobs/:id/settings — update relay mode and post-submit behavior.
   */
  app.patch("/jobs/:id/settings", (req: Request, res: Response): void => {
    const job = getJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    const body = req.body as UpdateSettingsBody;
    if (body.relayMode !== undefined && body.relayMode !== "auto" && body.relayMode !== "manual") {
      res.status(400).json({ error: "relayMode must be 'auto' or 'manual'" });
      return;
    }
    if (
      body.postSubmitBehavior !== undefined &&
      body.postSubmitBehavior !== "pause" &&
      body.postSubmitBehavior !== "auto_prepare"
    ) {
      res.status(400).json({ error: "postSubmitBehavior must be 'pause' or 'auto_prepare'" });
      return;
    }
    if (body.relayMode === undefined && body.postSubmitBehavior === undefined) {
      res.status(400).json({ error: "At least one settings field is required." });
      return;
    }

    try {
      const updated = updateJobSettings(job.id, body);
      res.json(updated);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(409).json({ error: message });
    }
  });

  /**
   * POST /jobs/:id/refresh — refresh planner/source/destination status only.
   */
  app.post("/jobs/:id/refresh", (req: Request, res: Response): void => {
    const job = getJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    refreshJob(job.id)
      .then((updated) => {
        res.json(updated);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        res.status(409).json({ error: message });
      });
  });

  /**
   * POST /jobs/:id/prepare — prepare selected or planner stage.
   * Returns 202 immediately; poll GET /jobs/:id for status updates.
   */
  app.post("/jobs/:id/prepare", (req: Request, res: Response): void => {
    const job = getJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    const body = req.body as PrepareStageBody;
    if (body.stage !== undefined && !VALID_STAGE_SET.has(body.stage)) {
      res
        .status(400)
        .json({ error: `Invalid stage. Expected one of: ${VALID_STAGES.join(", ")}.` });
      return;
    }

    prepareJobStage(job.id, body)
      .then(() => {
        res.status(202).json(getJob(job.id));
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        res.status(409).json({ error: message });
      });
  });

  /**
   * GET /jobs/:id/stages/current — structured details for the job's current active stage.
   *
   * Returns `StageDetails` for `job.currentStage`.  Works for both auto and manual
   * relay modes; the web app uses this instead of the retired legacy endpoint.
   *
   * Responds 409 when there is no active stage (pending / completed job).
   */
  app.get("/jobs/:id/stages/current", (req: Request, res: Response): void => {
    const job = getJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    const stage = job.currentStage;
    if (stage === "pending" || stage === "completed") {
      res.status(409).json({ error: `No active stage in state ${stage}` });
      return;
    }

    try {
      const details = getStageDetails(job.id, stage as RelayProofStage);
      res.json(details);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(409).json({ error: message });
    }
  });

  /**
   * GET /jobs/:id/stages/:stage — structured stage details for manual flow.
   */
  app.get("/jobs/:id/stages/:stage", (req: Request, res: Response): void => {
    const job = getJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    const stage = parseRelayStage(req.params.stage);
    if (!stage) {
      res
        .status(400)
        .json({ error: `Invalid stage. Expected one of: ${VALID_STAGES.join(", ")}.` });
      return;
    }

    try {
      const details = getStageDetails(job.id, stage);
      res.json(details);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(409).json({ error: message });
    }
  });

  /**
   * POST /jobs/:id/receipts — browser confirmed relay tx submission.
   * Advances the job to the next stage or marks it completed.
   */
  app.post("/jobs/:id/receipts", (req: Request, res: Response): void => {
    const job = getJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    const body = req.body as Partial<ReceiptBody>;
    const { stage, txHash } = body;

    if (!stage || !txHash) {
      res.status(400).json({ error: "stage and txHash are required" });
      return;
    }

    if (!VALID_STAGE_SET.has(stage)) {
      res
        .status(400)
        .json({ error: `Invalid stage. Expected one of: ${VALID_STAGES.join(", ")}.` });
      return;
    }

    try {
      recordReceipt(job.id, stage, txHash);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(409).json({ error: message });
      return;
    }

    res.json(getJob(job.id));
  });

  // ── Recovery ────────────────────────────────────────────────────────────

  /**
   * POST /jobs/recover — reconstruct a job after local DB loss using only the txId.
   *
   * Body: { txId, sourceProfileHint?, destinationProfileHint? }
   *
   * Responses:
   *   200 — job already exists locally (resumed)
   *   201 — new job created from on-chain discovery
   *   404 — no on-chain evidence found
   *   409 — ambiguous: multiple source candidates found; body contains `candidates[]`
   */
  app.post("/jobs/recover", (req: Request, res: Response): void => {
    const body = req.body as Partial<RecoverJobBody>;
    const { txId, sourceProfileHint, destinationProfileHint } = body;

    if (!txId) {
      res.status(400).json({ error: "txId is required" });
      return;
    }

    recoverJob(txId, sourceProfileHint, destinationProfileHint)
      .then((result) => {
        if (result.type === "ambiguous") {
          res.status(409).json({ error: "Ambiguous recovery: multiple candidates found", candidates: result.candidates });
          return;
        }
        res.status(result.type === "created" ? 201 : 200).json(result.job);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("No on-chain evidence")) {
          res.status(404).json({ error: message });
        } else {
          console.error(`[server] recoverJob error: ${message}`);
          res.status(500).json({ error: message });
        }
      });
  });

  // ── Custom scheme forwarding ─────────────────────────────────────────────
  // The macOS helper calls POST /scheme with the raw trustless-client:// URL.
  // Creates a job in awaiting_confirmation state — browser must confirm.
  app.post(
    "/scheme",
    express.urlencoded({ extended: false }),
    (req: Request, res: Response): void => {
      const raw = req.body?.url as string | undefined;
      if (!raw) {
        res.status(400).json({ error: "Missing url body field" });
        return;
      }

      let params: ReturnType<typeof parseSchemeUrl>;
      try {
        params = parseSchemeUrl(decodeURIComponent(raw));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(400).json({ error: message });
        return;
      }

      const existing = getJobByTxId(params.txId);
      if (existing) {
        res.json({ jobId: existing.id, status: "resumed" });
        return;
      }

      const intent = {
        sourceProfile: params.sourceProfile,
        destinationProfile: params.destinationProfile,
        sourceConnector: params.sourceConnector,
        destinationConnector: params.destinationConnector,
        tokenFrom: "",
        tokenTo: "",
        amount: "0",
        receiver: "",
      };

      const job = createJob(intent, params.txId);
      res.json({ jobId: job.id, status: "awaiting_confirmation" });
    },
  );

  return app;
}

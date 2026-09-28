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
import type { RelayJob } from "./contracts.js";
import type {
  CreateJobBody,
  PrepareStageBody,
  ReceiptBody,
  RecoverJobBody,
  UpdateSettingsBody,
} from "./types.js";
import { ALL_RELAY_STAGES, isRelayStage } from "../relay/stages.js";
import { errorMessage } from "../core/utils.js";

const AGENT_VERSION = "0.1.0";

const INVALID_STAGE_ERROR = `Invalid stage. Expected one of: ${ALL_RELAY_STAGES.join(", ")}.`;

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

/** Loads the job named by the `:id` route param, or responds 404 and returns undefined. */
function requireJob(req: Request, res: Response): RelayJob | undefined {
  const job = getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
  }
  return job;
}

/** Responds 409 Conflict with the error's message — used for rejected state transitions. */
function sendConflict(res: Response, err: unknown): void {
  res.status(409).json({ error: errorMessage(err) });
}

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5173", // Vite dev
  "http://localhost:4173", // Vite preview
];

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
    const job = requireJob(req, res);
    if (job) res.json(job);
  });

  /**
   * POST /jobs/:id/confirm — start verified stage preparation.
   * Moves the job from awaiting_confirmation → preparing_stage.
   * Returns 202 immediately; poll GET /jobs/:id for status updates.
   */
  app.post("/jobs/:id/confirm", (req: Request, res: Response): void => {
    const job = requireJob(req, res);
    if (!job) return;

    confirmJob(job.id).catch((err: unknown) => {
      console.error(`[server] confirmJob error for ${job.id}: ${errorMessage(err)}`);
    });

    // Return current state — client polls for updates
    res.status(202).json(getJob(job.id));
  });

  /**
   * PATCH /jobs/:id/settings — update relay mode and post-submit behavior.
   */
  app.patch("/jobs/:id/settings", (req: Request, res: Response): void => {
    const job = requireJob(req, res);
    if (!job) return;

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
      res.json(updateJobSettings(job.id, body));
    } catch (err) {
      sendConflict(res, err);
    }
  });

  /**
   * POST /jobs/:id/refresh — refresh planner/source/destination status only.
   */
  app.post("/jobs/:id/refresh", (req: Request, res: Response): void => {
    const job = requireJob(req, res);
    if (!job) return;

    refreshJob(job.id)
      .then((updated) => res.json(updated))
      .catch((err: unknown) => sendConflict(res, err));
  });

  /**
   * POST /jobs/:id/prepare — prepare selected or planner stage.
   * Returns 202 immediately; poll GET /jobs/:id for status updates.
   */
  app.post("/jobs/:id/prepare", (req: Request, res: Response): void => {
    const job = requireJob(req, res);
    if (!job) return;

    const body = req.body as PrepareStageBody;
    if (body.stage !== undefined && !isRelayStage(body.stage)) {
      res.status(400).json({ error: INVALID_STAGE_ERROR });
      return;
    }

    prepareJobStage(job.id, body)
      .then(() => res.status(202).json(getJob(job.id)))
      .catch((err: unknown) => sendConflict(res, err));
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
    const job = requireJob(req, res);
    if (!job) return;

    const stage = job.currentStage;
    if (stage === "pending" || stage === "completed") {
      res.status(409).json({ error: `No active stage in state ${stage}` });
      return;
    }

    try {
      res.json(getStageDetails(job.id, stage));
    } catch (err) {
      sendConflict(res, err);
    }
  });

  /**
   * GET /jobs/:id/stages/:stage — structured stage details for manual flow.
   */
  app.get("/jobs/:id/stages/:stage", (req: Request, res: Response): void => {
    const job = requireJob(req, res);
    if (!job) return;

    const { stage } = req.params;
    if (!isRelayStage(stage)) {
      res.status(400).json({ error: INVALID_STAGE_ERROR });
      return;
    }

    try {
      res.json(getStageDetails(job.id, stage));
    } catch (err) {
      sendConflict(res, err);
    }
  });

  /**
   * POST /jobs/:id/receipts — browser confirmed relay tx submission.
   * Advances the job to the next stage or marks it completed.
   */
  app.post("/jobs/:id/receipts", (req: Request, res: Response): void => {
    const job = requireJob(req, res);
    if (!job) return;

    const body = req.body as Partial<ReceiptBody>;
    const { stage, txHash } = body;

    if (!stage || !txHash) {
      res.status(400).json({ error: "stage and txHash are required" });
      return;
    }

    if (!isRelayStage(stage)) {
      res.status(400).json({ error: INVALID_STAGE_ERROR });
      return;
    }

    try {
      recordReceipt(job.id, stage, txHash);
    } catch (err) {
      sendConflict(res, err);
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
          res.status(409).json({
            error: "Ambiguous recovery: multiple candidates found",
            candidates: result.candidates,
          });
          return;
        }
        res.status(result.type === "created" ? 201 : 200).json(result.job);
      })
      .catch((err: unknown) => {
        const message = errorMessage(err);
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
        res.status(400).json({ error: errorMessage(err) });
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

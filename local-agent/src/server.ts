import express, { type Request, type Response, type NextFunction } from "express";
import {
  createJob,
  getJob,
  getJobByTxId,
  listJobs,
  getCheckpoint
} from "./db.js";
import { confirmJob, recordReceipt } from "./services/job-service.js";
import { parseSchemeUrl } from "./scheme.js";
import type { CreateJobBody, ReceiptBody } from "./types.js";

const AGENT_VERSION = "0.1.0";

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5173", // Vite dev
  "http://localhost:4173"  // Vite preview
];

function buildCorsMiddleware(allowedOriginsEnv?: string) {
  const allowed = new Set<string>([
    ...DEFAULT_ALLOWED_ORIGINS,
    ...(allowedOriginsEnv ?? "").split(",").map((s) => s.trim()).filter(Boolean)
  ]);

  return function cors(req: Request, res: Response, next: NextFunction): void {
    const origin = req.headers["origin"];
    if (origin && allowed.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
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
      pid: process.pid
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
   * GET /jobs/:id/next-stage — return enriched stage payload when ready.
   * Returns the EnrichedStagePayload (with verificationMode, verificationDegraded).
   */
  app.get("/jobs/:id/next-stage", (req: Request, res: Response): void => {
    const job = getJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    if (job.status !== "ready_for_signature") {
      res.status(409).json({
        error: `Stage payload not ready. Current status: ${job.status}`
      });
      return;
    }

    const stage = job.currentStage;
    if (stage === "pending" || stage === "completed") {
      res.status(409).json({ error: `No active stage in state ${stage}` });
      return;
    }

    const checkpoint = getCheckpoint(job.id, stage);
    if (!checkpoint) {
      res.status(404).json({ error: "Stage checkpoint not found" });
      return;
    }

    res.json(JSON.parse(checkpoint.payloadJson));
  });

  /**
   * GET /jobs/:id/stages/:stage/proof — legacy endpoint; returns plain payload.
   */
  app.get(
    "/jobs/:id/stages/:stage/proof",
    (req: Request, res: Response): void => {
      const job = getJob(req.params.id);
      if (!job) {
        res.status(404).json({ error: "Job not found" });
        return;
      }

      const stage = req.params.stage as "lock" | "mint" | "ack";
      if (!["lock", "mint", "ack"].includes(stage)) {
        res.status(400).json({ error: "Invalid stage. Expected lock, mint, or ack." });
        return;
      }

      const checkpoint = getCheckpoint(job.id, stage);
      if (!checkpoint) {
        res.status(404).json({ error: "No proof checkpoint for this stage yet" });
        return;
      }

      res.json(JSON.parse(checkpoint.payloadJson));
    }
  );

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

    if (!["lock", "mint", "ack"].includes(stage)) {
      res.status(400).json({ error: "Invalid stage. Expected lock, mint, or ack." });
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
        receiver: ""
      };

      const job = createJob(intent, params.txId);
      res.json({ jobId: job.id, status: "awaiting_confirmation" });
    }
  );

  return app;
}

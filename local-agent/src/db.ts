import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  JobStatus,
  RelayJob,
  TransferIntent,
  VerificationSummary
} from "agent-shared";
import type { StageCheckpoint } from "./types.js";

// ---------------------------------------------------------------------------
// Database path
// ---------------------------------------------------------------------------

export function agentDataDir(): string {
  const dir = join(homedir(), ".trustless-agent");
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// DB bootstrap
// ---------------------------------------------------------------------------

let _db: Database.Database | undefined;

export function openDb(dbPath?: string): Database.Database {
  if (_db) return _db;
  const path = dbPath ?? join(agentDataDir(), "jobs.db");
  _db = new Database(path);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  migrate(_db);
  return _db;
}

/** Allow tests to inject a different db handle (e.g. in-memory). Runs migrations automatically. */
export function setDb(db: Database.Database): void {
  _db = db;
  migrate(db);
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id                     TEXT PRIMARY KEY,
      tx_id                  TEXT NOT NULL,
      current_stage          TEXT NOT NULL DEFAULT 'pending',
      status                 TEXT NOT NULL DEFAULT 'awaiting_confirmation',
      source_status          INTEGER NOT NULL DEFAULT 0,
      destination_status     INTEGER NOT NULL DEFAULT 0,
      last_error             TEXT,
      latest_submission_hash TEXT,
      intent_json            TEXT NOT NULL,
      verification_summary_json TEXT,
      created_at             INTEGER NOT NULL,
      updated_at             INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stage_checkpoints (
      job_id              TEXT NOT NULL REFERENCES jobs(id),
      stage               TEXT NOT NULL,
      payload_json        TEXT NOT NULL,
      verification_json   TEXT,
      completed_at        INTEGER,
      submission_hash     TEXT,
      PRIMARY KEY (job_id, stage)
    );
  `);

  // Migrate legacy status values from old schema (non-destructive)
  const legacyMap: Record<string, string> = {
    pending: "awaiting_confirmation",
    running: "preparing_stage",
    "proof-ready": "ready_for_signature",
    done: "completed",
    error: "failed"
  };
  for (const [old, next] of Object.entries(legacyMap)) {
    db.prepare(`UPDATE jobs SET status = ? WHERE status = ?`).run(next, old);
  }

  // Add new columns to existing tables if missing (idempotent ALTER TABLE)
  const jobCols = (db.prepare(`PRAGMA table_info(jobs)`).all() as Array<{ name: string }>)
    .map((r) => r.name);
  if (!jobCols.includes("verification_summary_json")) {
    db.exec(`ALTER TABLE jobs ADD COLUMN verification_summary_json TEXT`);
  }

  const cpCols = (
    db.prepare(`PRAGMA table_info(stage_checkpoints)`).all() as Array<{ name: string }>
  ).map((r) => r.name);
  if (!cpCols.includes("verification_json")) {
    db.exec(
      `ALTER TABLE stage_checkpoints ADD COLUMN verification_json TEXT`
    );
  }
}

// ---------------------------------------------------------------------------
// Job CRUD
// ---------------------------------------------------------------------------

function rowToJob(row: Record<string, unknown>): RelayJob {
  return {
    id: row.id as string,
    txId: row.tx_id as string,
    currentStage: row.current_stage as RelayJob["currentStage"],
    status: row.status as JobStatus,
    sourceStatus: row.source_status as number,
    destinationStatus: row.destination_status as number,
    lastError:
      typeof row.last_error === "string" ? row.last_error : undefined,
    latestSubmissionTxHash:
      typeof row.latest_submission_hash === "string"
        ? row.latest_submission_hash
        : undefined,
    intent: JSON.parse(row.intent_json as string) as TransferIntent,
    verificationSummary:
      typeof row.verification_summary_json === "string"
        ? (JSON.parse(row.verification_summary_json) as VerificationSummary)
        : undefined,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number
  };
}

export function createJob(
  intent: TransferIntent,
  txId: string,
  db = openDb()
): RelayJob {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(`
    INSERT INTO jobs
      (id, tx_id, current_stage, status, source_status, destination_status,
       intent_json, created_at, updated_at)
    VALUES (?, ?, 'pending', 'awaiting_confirmation', 0, 0, ?, ?, ?)
  `).run(id, txId, JSON.stringify(intent), now, now);
  return getJob(id, db)!;
}

export function getJob(
  id: string,
  db = openDb()
): RelayJob | undefined {
  const row = db
    .prepare(`SELECT * FROM jobs WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToJob(row) : undefined;
}

export function getJobByTxId(
  txId: string,
  db = openDb()
): RelayJob | undefined {
  const row = db
    .prepare(
      `SELECT * FROM jobs WHERE tx_id = ? ORDER BY created_at DESC LIMIT 1`
    )
    .get(txId) as Record<string, unknown> | undefined;
  return row ? rowToJob(row) : undefined;
}

export function listJobs(db = openDb()): RelayJob[] {
  const rows = db
    .prepare(`SELECT * FROM jobs ORDER BY created_at DESC`)
    .all() as Array<Record<string, unknown>>;
  return rows.map(rowToJob);
}

export interface JobPatch {
  currentStage?: RelayJob["currentStage"];
  status?: JobStatus;
  sourceStatus?: number;
  destinationStatus?: number;
  lastError?: string | null;
  latestSubmissionTxHash?: string | null;
  verificationSummary?: VerificationSummary | null;
}

export function updateJob(
  id: string,
  patch: JobPatch,
  db = openDb()
): void {
  const sets: string[] = ["updated_at = ?"];
  const values: unknown[] = [Date.now()];

  if (patch.currentStage !== undefined) {
    sets.push("current_stage = ?");
    values.push(patch.currentStage);
  }
  if (patch.status !== undefined) {
    sets.push("status = ?");
    values.push(patch.status);
  }
  if (patch.sourceStatus !== undefined) {
    sets.push("source_status = ?");
    values.push(patch.sourceStatus);
  }
  if (patch.destinationStatus !== undefined) {
    sets.push("destination_status = ?");
    values.push(patch.destinationStatus);
  }
  if (patch.lastError !== undefined) {
    sets.push("last_error = ?");
    values.push(patch.lastError ?? null);
  }
  if (patch.latestSubmissionTxHash !== undefined) {
    sets.push("latest_submission_hash = ?");
    values.push(patch.latestSubmissionTxHash ?? null);
  }
  if (patch.verificationSummary !== undefined) {
    sets.push("verification_summary_json = ?");
    values.push(
      patch.verificationSummary ? JSON.stringify(patch.verificationSummary) : null
    );
  }

  values.push(id);
  db.prepare(`UPDATE jobs SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

// ---------------------------------------------------------------------------
// Stage checkpoint CRUD
// ---------------------------------------------------------------------------

function checkpointRow(row: Record<string, unknown>): StageCheckpoint {
  return {
    jobId: row.job_id as string,
    stage: row.stage as StageCheckpoint["stage"],
    payloadJson: row.payload_json as string,
    verificationJson:
      typeof row.verification_json === "string"
        ? row.verification_json
        : undefined,
    completedAt:
      typeof row.completed_at === "number" ? row.completed_at : undefined,
    submissionTxHash:
      typeof row.submission_hash === "string"
        ? row.submission_hash
        : undefined
  };
}

export function upsertCheckpoint(
  checkpoint: StageCheckpoint,
  db = openDb()
): void {
  db.prepare(`
    INSERT INTO stage_checkpoints
      (job_id, stage, payload_json, verification_json, completed_at, submission_hash)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (job_id, stage) DO UPDATE SET
      payload_json     = excluded.payload_json,
      verification_json = excluded.verification_json,
      completed_at     = excluded.completed_at,
      submission_hash  = excluded.submission_hash
  `).run(
    checkpoint.jobId,
    checkpoint.stage,
    checkpoint.payloadJson,
    checkpoint.verificationJson ?? null,
    checkpoint.completedAt ?? null,
    checkpoint.submissionTxHash ?? null
  );
}

export function getCheckpoint(
  jobId: string,
  stage: StageCheckpoint["stage"],
  db = openDb()
): StageCheckpoint | undefined {
  const row = db
    .prepare(
      `SELECT * FROM stage_checkpoints WHERE job_id = ? AND stage = ?`
    )
    .get(jobId, stage) as Record<string, unknown> | undefined;
  return row ? checkpointRow(row) : undefined;
}

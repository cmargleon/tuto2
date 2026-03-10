import type { ActiveBatchState, BatchPromptConfig, BootstrapState } from "../../shared/types";
import { sqliteDatabase } from "./sqlite-database";

export class RuntimeStateRepository {
  private readonly db = sqliteDatabase.connection;

  getBootstrapState(): BootstrapState {
    const row = this.db.prepare(`
      SELECT
        started_at AS startedAt,
        finished_at AS finishedAt,
        status,
        last_error AS lastError,
        pending_jobs AS pendingJobs,
        running_jobs AS runningJobs,
        completed_jobs AS completedJobs,
        total_products AS totalProducts
      FROM bootstrap_state
      WHERE id = 1
    `).get() as BootstrapState | undefined;

    return row ?? {
      status: "idle",
      pendingJobs: 0,
      runningJobs: 0,
      completedJobs: 0,
      totalProducts: 0
    };
  }

  setBootstrapState(state: BootstrapState): void {
    this.db.prepare(`
      INSERT INTO bootstrap_state (
        id, started_at, finished_at, status, last_error,
        pending_jobs, running_jobs, completed_jobs, total_products
      )
      VALUES (
        1, @startedAt, @finishedAt, @status, @lastError,
        @pendingJobs, @runningJobs, @completedJobs, @totalProducts
      )
      ON CONFLICT(id) DO UPDATE SET
        started_at = excluded.started_at,
        finished_at = excluded.finished_at,
        status = excluded.status,
        last_error = excluded.last_error,
        pending_jobs = excluded.pending_jobs,
        running_jobs = excluded.running_jobs,
        completed_jobs = excluded.completed_jobs,
        total_products = excluded.total_products
    `).run({
      ...state,
      startedAt: state.startedAt ?? null,
      finishedAt: state.finishedAt ?? null,
      lastError: state.lastError ?? null
    });
  }

  getActiveBatchState(): ActiveBatchState | null {
    const row = this.db.prepare(`
      SELECT
        batch_id AS batchId,
        session_root AS sessionRoot,
        staged_input_root AS stagedInputRoot,
        started_at AS startedAt,
        snapshot_count AS snapshotCount,
        last_saved_at AS lastSavedAt
      FROM active_batch_state
      WHERE id = 1
    `).get() as ActiveBatchState | undefined;

    if (!row?.batchId) {
      return null;
    }
    return row;
  }

  setActiveBatchState(state: ActiveBatchState): void {
    this.db.prepare(`
      INSERT INTO active_batch_state (
        id, batch_id, session_root, staged_input_root, started_at, snapshot_count, last_saved_at
      )
      VALUES (
        1, @batchId, @sessionRoot, @stagedInputRoot, @startedAt, @snapshotCount, @lastSavedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        batch_id = excluded.batch_id,
        session_root = excluded.session_root,
        staged_input_root = excluded.staged_input_root,
        started_at = excluded.started_at,
        snapshot_count = excluded.snapshot_count,
        last_saved_at = excluded.last_saved_at
    `).run({
      ...state,
      lastSavedAt: state.lastSavedAt ?? null
    });
  }

  clearActiveBatchState(): void {
    this.db.prepare("DELETE FROM active_batch_state WHERE id = 1").run();
  }

  getDraftPromptConfig<T extends BatchPromptConfig>(fallback: T): T {
    const row = this.db.prepare(`
      SELECT value_json AS valueJson
      FROM runtime_state
      WHERE state_key = 'draft_prompt_config'
    `).get() as { valueJson: string } | undefined;

    if (!row?.valueJson) {
      return fallback;
    }

    try {
      return JSON.parse(row.valueJson) as T;
    } catch {
      return fallback;
    }
  }

  setDraftPromptConfig(config: BatchPromptConfig): void {
    this.db.prepare(`
      INSERT INTO runtime_state (state_key, value_json)
      VALUES ('draft_prompt_config', ?)
      ON CONFLICT(state_key) DO UPDATE SET value_json = excluded.value_json
    `).run(JSON.stringify(config));
  }
}

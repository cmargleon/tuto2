import type { BatchJob, BatchJobAttempt, PoseInput } from "../../shared/types";
import { sqliteDatabase } from "./sqlite-database";

export class JobRepository {
  private readonly db = sqliteDatabase.connection;

  listJobs(batchId: string, status?: BatchJob["status"]): BatchJob[] {
    const whereClause = status ? "WHERE batch_id = ? AND status = ?" : "WHERE batch_id = ?";
    const params = status ? [batchId, status] : [batchId];
    return this.db.prepare(`
      SELECT
        job_id AS jobId,
        batch_id AS batchId,
        product_id AS productId,
        pose_id AS poseId,
        pose_label AS poseLabel,
        pose_file_path AS poseFilePath,
        priority,
        status,
        attempts,
        created_at AS createdAt,
        updated_at AS updatedAt,
        started_at AS startedAt,
        finished_at AS finishedAt,
        last_error AS lastError
      FROM jobs
      ${whereClause}
      ORDER BY
        CASE status
          WHEN 'running' THEN 0
          WHEN 'pending' THEN 1
          WHEN 'error' THEN 2
          ELSE 3
        END,
        priority DESC,
        updated_at DESC,
        created_at DESC
    `).all(...params) as BatchJob[];
  }

  listPendingJobs(batchId: string): BatchJob[] {
    return this.listJobs(batchId, "pending").sort((left, right) => {
      if (right.priority !== left.priority) {
        return right.priority - left.priority;
      }
      return left.createdAt.localeCompare(right.createdAt);
    });
  }

  getCounts(batchId: string): { pendingJobs: number; runningJobs: number } {
    const row = this.db.prepare(`
      SELECT
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pendingJobs,
        SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS runningJobs
      FROM jobs
      WHERE batch_id = ?
    `).get(batchId) as { pendingJobs?: number | null; runningJobs?: number | null } | undefined;

    return {
      pendingJobs: Number(row?.pendingJobs ?? 0),
      runningJobs: Number(row?.runningJobs ?? 0)
    };
  }

  replaceBatchJobs(batchId: string, jobs: Array<{ productId: string; pose: PoseInput; priority?: number }>): void {
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM jobs WHERE batch_id = ?").run(batchId);
      const insertJob = this.db.prepare(`
        INSERT INTO jobs (
          job_id, batch_id, product_id, pose_id, pose_label, pose_file_path, priority, status, attempts,
          created_at, updated_at, started_at, finished_at, last_error
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, NULL, NULL, NULL)
      `);
      jobs.forEach((job) => {
        insertJob.run(
          buildJobId(batchId, job.productId, job.pose.poseId),
          batchId,
          job.productId,
          job.pose.poseId,
          job.pose.label,
          job.pose.filePath,
          job.priority ?? 0,
          now,
          now
        );
      });
    })();
  }

  upsertJob(batchId: string, productId: string, pose: PoseInput, priority: number): void {
    const jobId = buildJobId(batchId, productId, pose.poseId);
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO jobs (
        job_id, batch_id, product_id, pose_id, pose_label, pose_file_path, priority, status, attempts,
        created_at, updated_at, started_at, finished_at, last_error
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, NULL, NULL, NULL)
      ON CONFLICT(job_id) DO UPDATE SET
        pose_label = excluded.pose_label,
        pose_file_path = excluded.pose_file_path,
        priority = excluded.priority,
        status = 'pending',
        updated_at = excluded.updated_at,
        started_at = NULL,
        finished_at = NULL,
        last_error = NULL
    `).run(jobId, batchId, productId, pose.poseId, pose.label, pose.filePath, priority, now, now);
  }

  markRunning(jobId: string): void {
    const now = new Date().toISOString();
    const job = this.getJob(jobId);
    if (!job) {
      return;
    }
    const attemptId = `${jobId}:attempt:${job.attempts + 1}`;
    this.db.transaction(() => {
      this.db.prepare(`
        UPDATE jobs
        SET status = 'running',
            attempts = attempts + 1,
            updated_at = ?,
            started_at = ?,
            finished_at = NULL,
            last_error = NULL
        WHERE job_id = ?
      `).run(now, now, jobId);

      this.db.prepare(`
        INSERT INTO job_attempts (
          attempt_id, job_id, batch_id, product_id, pose_id, status, started_at, finished_at, error
        )
        VALUES (?, ?, ?, ?, ?, 'running', ?, NULL, NULL)
      `).run(attemptId, jobId, job.batchId, job.productId, job.poseId, now);
    })();
  }

  markCompleted(jobId: string): void {
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare(`
        UPDATE jobs
        SET status = 'completed',
            updated_at = ?,
            finished_at = ?,
            last_error = NULL
        WHERE job_id = ?
      `).run(now, now, jobId);

      this.db.prepare(`
        UPDATE job_attempts
        SET status = 'completed',
            finished_at = ?
        WHERE attempt_id = (
          SELECT attempt_id
          FROM job_attempts
          WHERE job_id = ? AND status = 'running'
          ORDER BY started_at DESC
          LIMIT 1
        )
      `).run(now, jobId);
    })();
  }

  markError(jobId: string, errorMessage: string): void {
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare(`
        UPDATE jobs
        SET status = 'error',
            updated_at = ?,
            finished_at = ?,
            last_error = ?
        WHERE job_id = ?
      `).run(now, now, errorMessage, jobId);

      this.db.prepare(`
        UPDATE job_attempts
        SET status = 'error',
            finished_at = ?,
            error = ?
        WHERE attempt_id = (
          SELECT attempt_id
          FROM job_attempts
          WHERE job_id = ? AND status = 'running'
          ORDER BY started_at DESC
          LIMIT 1
        )
      `).run(now, errorMessage, jobId);
    })();
  }

  recoverRunningJobs(batchId?: string): void {
    const now = new Date().toISOString();
    if (batchId) {
      this.db.prepare(`
        UPDATE jobs
        SET status = 'pending',
            updated_at = ?,
            started_at = NULL,
            finished_at = NULL
        WHERE batch_id = ? AND status = 'running'
      `).run(now, batchId);
      this.db.prepare(`
        UPDATE job_attempts
        SET status = 'error',
            finished_at = COALESCE(finished_at, ?),
            error = COALESCE(error, 'Interrupted by server restart.')
        WHERE batch_id = ? AND status = 'running'
      `).run(now, batchId);
      return;
    }

    this.db.prepare(`
      UPDATE jobs
      SET status = 'pending',
          updated_at = ?,
          started_at = NULL,
          finished_at = NULL
      WHERE status = 'running'
    `).run(now);
    this.db.prepare(`
      UPDATE job_attempts
      SET status = 'error',
          finished_at = COALESCE(finished_at, ?),
          error = COALESCE(error, 'Interrupted by server restart.')
      WHERE status = 'running'
    `).run(now);
  }

  listAttempts(jobId: string): BatchJobAttempt[] {
    return this.db.prepare(`
      SELECT
        attempt_id AS attemptId,
        job_id AS jobId,
        batch_id AS batchId,
        product_id AS productId,
        pose_id AS poseId,
        status,
        started_at AS startedAt,
        finished_at AS finishedAt,
        error
      FROM job_attempts
      WHERE job_id = ?
      ORDER BY started_at DESC
    `).all(jobId) as BatchJobAttempt[];
  }

  listAttemptsForBatch(batchId: string): BatchJobAttempt[] {
    return this.db.prepare(`
      SELECT
        attempt_id AS attemptId,
        job_id AS jobId,
        batch_id AS batchId,
        product_id AS productId,
        pose_id AS poseId,
        status,
        started_at AS startedAt,
        finished_at AS finishedAt,
        error
      FROM job_attempts
      WHERE batch_id = ?
      ORDER BY started_at DESC
    `).all(batchId) as BatchJobAttempt[];
  }

  private getJob(jobId: string): BatchJob | null {
    const row = this.db.prepare(`
      SELECT
        job_id AS jobId,
        batch_id AS batchId,
        product_id AS productId,
        pose_id AS poseId,
        pose_label AS poseLabel,
        pose_file_path AS poseFilePath,
        priority,
        status,
        attempts,
        created_at AS createdAt,
        updated_at AS updatedAt,
        started_at AS startedAt,
        finished_at AS finishedAt,
        last_error AS lastError
      FROM jobs
      WHERE job_id = ?
    `).get(jobId) as BatchJob | undefined;

    return row ?? null;
  }
}

export function buildJobId(batchId: string, productId: string, poseId: string): string {
  return `${batchId}:${productId}:${poseId}`;
}

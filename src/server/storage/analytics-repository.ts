import type {
  AnalyticsBreakdownRow,
  AnalyticsDashboard,
  AnalyticsEventRecord,
  AnalyticsFilterOptions,
  AnalyticsFilters,
  AnalyticsPromptRow,
  AnalyticsSeriesPoint,
  CostSnapshotRecord,
  GenerationUsageRecord,
  ProductCategory
} from "../../shared/types";
import { sqliteDatabase } from "./sqlite-database";

type GenerationUsageRow = {
  usageId: string;
  batchId: string;
  batchName?: string | null;
  batchStatus?: string | null;
  clientId?: string | null;
  clientName?: string | null;
  productId: string;
  poseId: string;
  category: string;
  provider: string;
  providerModelId: string;
  requestId?: string | null;
  source: "generation" | "regeneration";
  status: "running" | "success" | "error";
  systemPrompt: string;
  userPrompt: string;
  finalPrompt: string;
  promptHash: string;
  promptExcerpt: string;
  imageSizeLabel: string;
  seed?: number | null;
  syncMode: number;
  enableSafetyChecker: number;
  backgroundMode?: string | null;
  selectedModelId?: string | null;
  sourcePhotoId?: string | null;
  selectedPhotoIdsJson: string;
  startedAt: string;
  finishedAt?: string | null;
  durationMs?: number | null;
  outputCount: number;
  costSnapshotKey?: string | null;
  costEstimate: number;
  providerReportedCost?: number | null;
  currency: string;
  approvedAt?: string | null;
  errorMessage?: string | null;
  metadataJson?: string | null;
};

type AnalyticsEventRow = {
  eventId: string;
  batchId: string;
  clientId?: string | null;
  productId?: string | null;
  poseId?: string | null;
  category?: string | null;
  provider?: string | null;
  providerModelId?: string | null;
  eventType: AnalyticsEventRecord["eventType"];
  eventSource?: "system" | "user" | null;
  requestId?: string | null;
  timestamp: string;
  durationMs?: number | null;
  costEstimate?: number | null;
  providerReportedCost?: number | null;
  metadataJson?: string | null;
};

const CATEGORY_OPTIONS: ProductCategory[] = [
  "parte_alta",
  "parte_baja",
  "vestido",
  "interior_coordinado",
  "interior_superior",
  "interior_inferior",
  "producto_sin_modelo"
];

export class AnalyticsRepository {
  private readonly db = sqliteDatabase.connection;

  seedCostSnapshots(records: CostSnapshotRecord[]): void {
    const insert = this.db.prepare(`
      INSERT INTO cost_snapshots (
        snapshot_key, provider, provider_model_id, size_tier, unit_cost, currency, unit_label, source, notes, effective_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(snapshot_key) DO UPDATE SET
        provider = excluded.provider,
        provider_model_id = excluded.provider_model_id,
        size_tier = excluded.size_tier,
        unit_cost = excluded.unit_cost,
        currency = excluded.currency,
        unit_label = excluded.unit_label,
        source = excluded.source,
        notes = excluded.notes,
        effective_at = excluded.effective_at
    `);
    this.db.transaction(() => {
      for (const record of records) {
        insert.run(
          record.snapshotKey,
          record.provider,
          record.providerModelId,
          record.sizeTier,
          record.unitCost,
          record.currency,
          record.unitLabel,
          record.source,
          record.notes ?? null,
          record.effectiveAt
        );
      }
    })();
  }

  getCostSnapshot(snapshotKey: string): CostSnapshotRecord | null {
    const row = this.db.prepare(`
      SELECT
        snapshot_key AS snapshotKey,
        provider,
        provider_model_id AS providerModelId,
        size_tier AS sizeTier,
        unit_cost AS unitCost,
        currency,
        unit_label AS unitLabel,
        source,
        notes,
        effective_at AS effectiveAt
      FROM cost_snapshots
      WHERE snapshot_key = ?
    `).get(snapshotKey) as CostSnapshotRecord | undefined;
    return row ?? null;
  }

  saveEvent(event: AnalyticsEventRecord): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO analytics_events (
        event_id, batch_id, client_id, product_id, pose_id, category, provider, provider_model_id,
        event_type, event_source, request_id, timestamp, duration_ms, cost_estimate, provider_reported_cost, metadata_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.eventId,
      event.batchId,
      event.clientId ?? null,
      event.productId ?? null,
      event.poseId ?? null,
      event.category ?? null,
      event.provider ?? null,
      event.providerModelId ?? null,
      event.eventType,
      event.eventSource ?? null,
      event.requestId ?? null,
      event.timestamp,
      event.durationMs ?? null,
      event.costEstimate ?? null,
      event.providerReportedCost ?? null,
      event.metadata ? JSON.stringify(event.metadata) : null
    );
  }

  saveGenerationUsage(record: GenerationUsageRecord): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO generation_usage (
        usage_id, batch_id, client_id, product_id, pose_id, category, provider, provider_model_id, request_id,
        source, status, system_prompt, user_prompt, final_prompt, prompt_hash, prompt_excerpt, image_size_label, seed,
        sync_mode, enable_safety_checker, background_mode, selected_model_id, source_photo_id, selected_photo_ids_json,
        started_at, finished_at, duration_ms, output_count, cost_snapshot_key, cost_estimate, provider_reported_cost,
        currency, approved_at, error_message, metadata_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.usageId,
      record.batchId,
      record.clientId ?? null,
      record.productId,
      record.poseId,
      record.category,
      record.provider,
      record.providerModelId,
      record.requestId ?? null,
      record.source,
      record.status,
      record.systemPrompt,
      record.userPrompt,
      record.finalPrompt,
      record.promptHash,
      record.promptExcerpt,
      record.imageSizeLabel,
      record.seed ?? null,
      record.syncMode ? 1 : 0,
      record.enableSafetyChecker ? 1 : 0,
      record.backgroundMode ?? null,
      record.selectedModelId ?? null,
      record.sourcePhotoId ?? null,
      JSON.stringify(record.selectedPhotoIds ?? []),
      record.startedAt,
      record.finishedAt ?? null,
      record.durationMs ?? null,
      record.outputCount,
      record.costSnapshotKey ?? null,
      record.costEstimate,
      record.providerReportedCost ?? null,
      record.currency,
      record.approvedAt ?? null,
      record.errorMessage ?? null,
      record.metadata ? JSON.stringify(record.metadata) : null
    );
  }

  getGenerationUsage(usageId: string): GenerationUsageRecord | null {
    const row = this.db.prepare(`
      SELECT
        usage_id AS usageId,
        batch_id AS batchId,
        client_id AS clientId,
        product_id AS productId,
        pose_id AS poseId,
        category,
        provider,
        provider_model_id AS providerModelId,
        request_id AS requestId,
        source,
        status,
        system_prompt AS systemPrompt,
        user_prompt AS userPrompt,
        final_prompt AS finalPrompt,
        prompt_hash AS promptHash,
        prompt_excerpt AS promptExcerpt,
        image_size_label AS imageSizeLabel,
        seed,
        sync_mode AS syncMode,
        enable_safety_checker AS enableSafetyChecker,
        background_mode AS backgroundMode,
        selected_model_id AS selectedModelId,
        source_photo_id AS sourcePhotoId,
        selected_photo_ids_json AS selectedPhotoIdsJson,
        started_at AS startedAt,
        finished_at AS finishedAt,
        duration_ms AS durationMs,
        output_count AS outputCount,
        cost_snapshot_key AS costSnapshotKey,
        cost_estimate AS costEstimate,
        provider_reported_cost AS providerReportedCost,
        currency,
        approved_at AS approvedAt,
        error_message AS errorMessage,
        metadata_json AS metadataJson
      FROM generation_usage
      WHERE usage_id = ?
    `).get(usageId) as GenerationUsageRow | undefined;
    return row ? this.mapGenerationUsageRow(row) : null;
  }

  updateGenerationUsage(usageId: string, patch: Partial<GenerationUsageRecord>): void {
    const current = this.getGenerationUsage(usageId);
    if (!current) {
      return;
    }
    this.saveGenerationUsage({
      ...current,
      ...patch,
      selectedPhotoIds: patch.selectedPhotoIds ?? current.selectedPhotoIds,
      metadata: patch.metadata ?? current.metadata
    });
  }

  rebuildDerivedTables(): void {
    const usages = this.listGenerationUsage({});
    const updatedAt = new Date().toISOString();
    const dailyRows = new Map<string, {
      rollupDate: string;
      clientId?: string;
      providerModelId: string;
      generations: number;
      regenerations: number;
      errors: number;
      approvals: number;
      costEstimateTotal: number;
      providerReportedCostTotal: number;
      durationSum: number;
      durationCount: number;
    }>();
    const promptRows = new Map<string, {
      promptHash: string;
      promptExcerpt: string;
      usageCount: number;
      regenerationCount: number;
      successCount: number;
      errorCount: number;
      approvalCount: number;
      durationSum: number;
      durationCount: number;
      approvalLatencySum: number;
      approvalLatencyCount: number;
      totalEstimatedCost: number;
      lastUsedAt: string;
    }>();

    for (const usage of usages) {
      const day = usage.startedAt.slice(0, 10);
      const rollupKey = `${day}:${usage.clientId ?? "free"}:${usage.providerModelId}`;
      const daily = dailyRows.get(rollupKey) ?? {
        rollupDate: day,
        clientId: usage.clientId,
        providerModelId: usage.providerModelId,
        generations: 0,
        regenerations: 0,
        errors: 0,
        approvals: 0,
        costEstimateTotal: 0,
        providerReportedCostTotal: 0,
        durationSum: 0,
        durationCount: 0
      };
      daily.generations += 1;
      daily.regenerations += usage.source === "regeneration" ? 1 : 0;
      daily.errors += usage.status === "error" ? 1 : 0;
      daily.approvals += usage.approvedAt ? 1 : 0;
      daily.costEstimateTotal += usage.costEstimate;
      daily.providerReportedCostTotal += usage.providerReportedCost ?? 0;
      if (typeof usage.durationMs === "number") {
        daily.durationSum += usage.durationMs;
        daily.durationCount += 1;
      }
      dailyRows.set(rollupKey, daily);

      const prompt = promptRows.get(usage.promptHash) ?? {
        promptHash: usage.promptHash,
        promptExcerpt: usage.promptExcerpt,
        usageCount: 0,
        regenerationCount: 0,
        successCount: 0,
        errorCount: 0,
        approvalCount: 0,
        durationSum: 0,
        durationCount: 0,
        approvalLatencySum: 0,
        approvalLatencyCount: 0,
        totalEstimatedCost: 0,
        lastUsedAt: usage.startedAt
      };
      prompt.usageCount += 1;
      prompt.regenerationCount += usage.source === "regeneration" ? 1 : 0;
      prompt.successCount += usage.status === "success" ? 1 : 0;
      prompt.errorCount += usage.status === "error" ? 1 : 0;
      prompt.approvalCount += usage.approvedAt ? 1 : 0;
      prompt.totalEstimatedCost += usage.costEstimate;
      if (typeof usage.durationMs === "number") {
        prompt.durationSum += usage.durationMs;
        prompt.durationCount += 1;
      }
      if (usage.approvedAt) {
        const latency = new Date(usage.approvedAt).getTime() - new Date(usage.startedAt).getTime();
        if (Number.isFinite(latency) && latency >= 0) {
          prompt.approvalLatencySum += latency;
          prompt.approvalLatencyCount += 1;
        }
      }
      if (usage.startedAt > prompt.lastUsedAt) {
        prompt.lastUsedAt = usage.startedAt;
      }
      promptRows.set(usage.promptHash, prompt);
    }

    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM daily_analytics_rollups`).run();
      this.db.prepare(`DELETE FROM prompt_effectiveness`).run();
      const insertDaily = this.db.prepare(`
        INSERT INTO daily_analytics_rollups (
          rollup_key, rollup_date, client_id, provider_model_id, generations, regenerations, errors, approvals,
          cost_estimate_total, provider_reported_cost_total, avg_duration_ms, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const [key, row] of dailyRows) {
        insertDaily.run(
          key,
          row.rollupDate,
          row.clientId ?? null,
          row.providerModelId,
          row.generations,
          row.regenerations,
          row.errors,
          row.approvals,
          row.costEstimateTotal,
          row.providerReportedCostTotal,
          row.durationCount > 0 ? row.durationSum / row.durationCount : null,
          updatedAt
        );
      }

      const insertPrompt = this.db.prepare(`
        INSERT INTO prompt_effectiveness (
          prompt_hash, prompt_excerpt, usage_count, regeneration_count, success_count, error_count, approval_count,
          avg_duration_ms, avg_approval_latency_ms, total_estimated_cost, last_used_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const row of promptRows.values()) {
        insertPrompt.run(
          row.promptHash,
          row.promptExcerpt,
          row.usageCount,
          row.regenerationCount,
          row.successCount,
          row.errorCount,
          row.approvalCount,
          row.durationCount > 0 ? row.durationSum / row.durationCount : null,
          row.approvalLatencyCount > 0 ? row.approvalLatencySum / row.approvalLatencyCount : null,
          row.totalEstimatedCost,
          row.lastUsedAt
        );
      }
    })();
  }

  getFilterOptions(): AnalyticsFilterOptions {
    const clients = this.db.prepare(`
      SELECT client_id AS clientId, name, notes, 0 AS batchCount, 0 AS activeBatchCount
      FROM clients
      ORDER BY name ASC
    `).all() as AnalyticsFilterOptions["clients"];
    const models = this.db.prepare(`
      SELECT provider_model_id AS providerModelId
      FROM generation_usage
      GROUP BY provider_model_id
      UNION
      SELECT provider_model_id
      FROM cost_snapshots
      GROUP BY provider_model_id
      ORDER BY providerModelId ASC
    `).all() as Array<{ providerModelId: string }>;
    const batches = this.db.prepare(`
      SELECT batch_id AS batchId, name
      FROM batches
      ORDER BY created_at DESC
    `).all() as Array<{ batchId: string; name: string }>;
    return {
      clients,
      models: models.map((row) => row.providerModelId),
      batches,
      categories: CATEGORY_OPTIONS,
      statuses: ["all", "draft", "running", "in_review", "paused", "completed", "archived", "error"]
    };
  }

  getDashboard(filters: AnalyticsFilters): AnalyticsDashboard {
    this.rebuildDerivedTables();
    const usageRows = this.listGenerationUsage(filters);
    const eventRows = this.listAnalyticsEvents(filters);
    return buildDashboard(filters, usageRows, eventRows);
  }

  private listGenerationUsage(filters: AnalyticsFilters): GenerationUsageRecord[] {
    const { whereClause, params } = buildFilterClause(filters);
    const rows = this.db.prepare(`
      SELECT
        gu.usage_id AS usageId,
        gu.batch_id AS batchId,
        b.name AS batchName,
        b.status AS batchStatus,
        gu.client_id AS clientId,
        c.name AS clientName,
        gu.product_id AS productId,
        gu.pose_id AS poseId,
        gu.category AS category,
        gu.provider AS provider,
        gu.provider_model_id AS providerModelId,
        gu.request_id AS requestId,
        gu.source AS source,
        gu.status AS status,
        gu.system_prompt AS systemPrompt,
        gu.user_prompt AS userPrompt,
        gu.final_prompt AS finalPrompt,
        gu.prompt_hash AS promptHash,
        gu.prompt_excerpt AS promptExcerpt,
        gu.image_size_label AS imageSizeLabel,
        gu.seed AS seed,
        gu.sync_mode AS syncMode,
        gu.enable_safety_checker AS enableSafetyChecker,
        gu.background_mode AS backgroundMode,
        gu.selected_model_id AS selectedModelId,
        gu.source_photo_id AS sourcePhotoId,
        gu.selected_photo_ids_json AS selectedPhotoIdsJson,
        gu.started_at AS startedAt,
        gu.finished_at AS finishedAt,
        gu.duration_ms AS durationMs,
        gu.output_count AS outputCount,
        gu.cost_snapshot_key AS costSnapshotKey,
        gu.cost_estimate AS costEstimate,
        gu.provider_reported_cost AS providerReportedCost,
        gu.currency AS currency,
        gu.approved_at AS approvedAt,
        gu.error_message AS errorMessage,
        gu.metadata_json AS metadataJson
      FROM generation_usage gu
      LEFT JOIN batches b ON b.batch_id = gu.batch_id
      LEFT JOIN clients c ON c.client_id = gu.client_id
      ${whereClause}
      ORDER BY gu.started_at DESC
    `).all(params) as GenerationUsageRow[];
    return rows.map((row) => this.mapGenerationUsageRow(row));
  }

  private listAnalyticsEvents(filters: AnalyticsFilters): AnalyticsEventRecord[] {
    const { whereClause, params } = buildEventFilterClause(filters);
    const rows = this.db.prepare(`
      SELECT
        ae.event_id AS eventId,
        ae.batch_id AS batchId,
        ae.client_id AS clientId,
        ae.product_id AS productId,
        ae.pose_id AS poseId,
        ae.category AS category,
        ae.provider AS provider,
        ae.provider_model_id AS providerModelId,
        ae.event_type AS eventType,
        ae.event_source AS eventSource,
        ae.request_id AS requestId,
        ae.timestamp AS timestamp,
        ae.duration_ms AS durationMs,
        ae.cost_estimate AS costEstimate,
        ae.provider_reported_cost AS providerReportedCost,
        ae.metadata_json AS metadataJson
      FROM analytics_events ae
      LEFT JOIN batches b ON b.batch_id = ae.batch_id
      ${whereClause}
      ORDER BY ae.timestamp DESC
    `).all(params) as AnalyticsEventRow[];
    return rows.map((row) => ({
      eventId: row.eventId,
      batchId: row.batchId,
      clientId: row.clientId ?? undefined,
      productId: row.productId ?? undefined,
      poseId: row.poseId ?? undefined,
      category: row.category as ProductCategory | undefined,
      provider: row.provider ?? undefined,
      providerModelId: row.providerModelId ?? undefined,
      eventType: row.eventType,
      eventSource: row.eventSource ?? undefined,
      requestId: row.requestId ?? undefined,
      timestamp: row.timestamp,
      durationMs: row.durationMs ?? undefined,
      costEstimate: row.costEstimate ?? undefined,
      providerReportedCost: row.providerReportedCost ?? undefined,
      metadata: parseJson<Record<string, string | number | boolean | null> | undefined>(row.metadataJson, undefined)
    }));
  }

  private mapGenerationUsageRow(row: GenerationUsageRow): GenerationUsageRecord {
    return {
      usageId: row.usageId,
      batchId: row.batchId,
      clientId: row.clientId ?? undefined,
      productId: row.productId,
      poseId: row.poseId,
      category: row.category as ProductCategory,
      provider: row.provider,
      providerModelId: row.providerModelId,
      requestId: row.requestId ?? undefined,
      source: row.source,
      status: row.status,
      systemPrompt: row.systemPrompt,
      userPrompt: row.userPrompt,
      finalPrompt: row.finalPrompt,
      promptHash: row.promptHash,
      promptExcerpt: row.promptExcerpt,
      imageSizeLabel: row.imageSizeLabel,
      seed: row.seed ?? undefined,
      syncMode: Boolean(row.syncMode),
      enableSafetyChecker: Boolean(row.enableSafetyChecker),
      backgroundMode: row.backgroundMode ?? undefined,
      selectedModelId: row.selectedModelId ?? undefined,
      sourcePhotoId: row.sourcePhotoId ?? undefined,
      selectedPhotoIds: parseJson<string[]>(row.selectedPhotoIdsJson, []),
      startedAt: row.startedAt,
      finishedAt: row.finishedAt ?? undefined,
      durationMs: row.durationMs ?? undefined,
      outputCount: row.outputCount,
      costSnapshotKey: row.costSnapshotKey ?? undefined,
      costEstimate: row.costEstimate,
      providerReportedCost: row.providerReportedCost ?? undefined,
      currency: row.currency,
      approvedAt: row.approvedAt ?? undefined,
      errorMessage: row.errorMessage ?? undefined,
      metadata: parseJson<Record<string, string | number | boolean | null> | undefined>(row.metadataJson, undefined)
    };
  }
}

function buildFilterClause(filters: AnalyticsFilters): { whereClause: string; params: Record<string, string> } {
  const clauses: string[] = [];
  const params: Record<string, string> = {};
  if (filters.from) {
    clauses.push("substr(gu.started_at, 1, 10) >= @from");
    params.from = filters.from;
  }
  if (filters.to) {
    clauses.push("substr(gu.started_at, 1, 10) <= @to");
    params.to = filters.to;
  }
  if (filters.clientId) {
    clauses.push("gu.client_id = @clientId");
    params.clientId = filters.clientId;
  }
  if (filters.providerModelId) {
    clauses.push("gu.provider_model_id = @providerModelId");
    params.providerModelId = filters.providerModelId;
  }
  if (filters.category && filters.category !== "all") {
    clauses.push("gu.category = @category");
    params.category = filters.category;
  }
  if (filters.batchId) {
    clauses.push("gu.batch_id = @batchId");
    params.batchId = filters.batchId;
  }
  if (filters.status && filters.status !== "all") {
    clauses.push("b.status = @batchStatus");
    params.batchStatus = filters.status;
  }
  return { whereClause: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

function buildEventFilterClause(filters: AnalyticsFilters): { whereClause: string; params: Record<string, string> } {
  const clauses: string[] = [];
  const params: Record<string, string> = {};
  if (filters.from) {
    clauses.push("substr(ae.timestamp, 1, 10) >= @from");
    params.from = filters.from;
  }
  if (filters.to) {
    clauses.push("substr(ae.timestamp, 1, 10) <= @to");
    params.to = filters.to;
  }
  if (filters.clientId) {
    clauses.push("ae.client_id = @clientId");
    params.clientId = filters.clientId;
  }
  if (filters.providerModelId) {
    clauses.push("ae.provider_model_id = @providerModelId");
    params.providerModelId = filters.providerModelId;
  }
  if (filters.category && filters.category !== "all") {
    clauses.push("ae.category = @category");
    params.category = filters.category;
  }
  if (filters.batchId) {
    clauses.push("ae.batch_id = @batchId");
    params.batchId = filters.batchId;
  }
  if (filters.status && filters.status !== "all") {
    clauses.push("b.status = @batchStatus");
    params.batchStatus = filters.status;
  }
  return { whereClause: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function buildDashboard(filters: AnalyticsFilters, usages: GenerationUsageRecord[], events: AnalyticsEventRecord[]): AnalyticsDashboard {
  const totalGenerations = usages.length;
  const totalRegenerations = usages.filter((item) => item.source === "regeneration").length;
  const totalCostEstimate = sum(usages.map((item) => item.costEstimate));
  const totalProviderReportedCost = sum(usages.map((item) => item.providerReportedCost ?? 0));
  const currentMonth = new Date().toISOString().slice(0, 7);
  const currentMonthCostEstimate = sum(usages.filter((item) => item.startedAt.startsWith(currentMonth)).map((item) => item.costEstimate));
  const totalOutputCount = sum(usages.map((item) => item.outputCount));
  const distinctProducts = new Set(usages.map((item) => `${item.batchId}:${item.productId}`));
  const approvedUsages = usages.filter((item) => Boolean(item.approvedAt));
  const firstPassApprovalRate = approvedUsages.length > 0
    ? approvedUsages.filter((item) => item.source === "generation").length / approvedUsages.length
    : 0;
  const averageApprovalTimeMs = average(approvedUsages
    .filter((item) => item.approvedAt)
    .map((item) => new Date(item.approvedAt as string).getTime() - new Date(item.startedAt).getTime())
    .filter((value) => Number.isFinite(value) && value >= 0));
  const averageBatchDurationMs = average(Object.values(groupBy(usages, (item) => item.batchId)).map((rows) => {
    const started = rows.map((item) => new Date(item.startedAt).getTime());
    const finished = rows.map((item) => item.finishedAt ? new Date(item.finishedAt).getTime() : NaN).filter((value) => Number.isFinite(value));
    if (!started.length || !finished.length) {
      return NaN;
    }
    return Math.max(...finished) - Math.min(...started);
  }).filter((value) => Number.isFinite(value)));
  const promptEdits = events.filter((item) => item.eventType === "prompt_changed").length;
  const batchStatusById = new Map<string, string>();
  for (const usage of usages) {
    const status = String(usage.metadata?.batchStatus ?? "");
    if (status) {
      batchStatusById.set(usage.batchId, status);
    }
  }
  const completedBatches = [...batchStatusById.values()].filter((value) => value === "completed").length;
  const abandonedBatches = [...batchStatusById.values()].filter((value) => ["archived", "paused", "error"].includes(value)).length;

  return {
    filters,
    kpis: {
      totalGenerations,
      totalRegenerations,
      regenerationRate: ratio(totalRegenerations, totalGenerations),
      totalCostEstimate,
      totalProviderReportedCost,
      currentMonthCostEstimate,
      averageCostPerImage: totalOutputCount > 0 ? totalCostEstimate / totalOutputCount : 0,
      averageCostPerProduct: distinctProducts.size > 0 ? totalCostEstimate / distinctProducts.size : 0,
      averageDurationMs: average(usages.map((item) => item.durationMs).filter((value): value is number => typeof value === "number")),
      averageBatchDurationMs,
      averageApprovalTimeMs,
      firstPassApprovalRate,
      completedBatches,
      abandonedBatches,
      promptEdits
    },
    charts: {
      regenerationsByDay: aggregateSeries(usages.filter((item) => item.source === "regeneration"), (item) => item.startedAt.slice(0, 10), () => 1),
      costByDay: aggregateSeries(usages, (item) => item.startedAt.slice(0, 10), (item) => item.costEstimate),
      costByClient: aggregateBreakdown(usages, (item) => String(item.metadata?.clientName ?? item.clientId ?? "Sin cliente"), (item) => item.costEstimate),
      usageByModel: aggregateBreakdown(usages, (item) => item.providerModelId, () => 1, (rows) => sum(rows.map((item) => item.costEstimate))),
      errorsByModel: aggregateBreakdown(usages.filter((item) => item.status === "error"), (item) => item.providerModelId, () => 1),
      categoryDifficulty: aggregateBreakdown(usages, (item) => item.category, (item) => item.source === "regeneration" ? 1 : 0, (rows) => rows.filter((item) => item.status === "error").length)
    },
    tables: {
      topClientsByCost: aggregateBreakdown(usages, (item) => String(item.metadata?.clientName ?? item.clientId ?? "Sin cliente"), (item) => item.costEstimate).slice(0, 8),
      topClientsByFriction: aggregateBreakdown(usages, (item) => String(item.metadata?.clientName ?? item.clientId ?? "Sin cliente"), (item) => item.source === "regeneration" ? 1 : 0, (rows) => rows.filter((item) => item.status === "error").length).slice(0, 8),
      topProductsByRegenerations: aggregateBreakdown(usages, (item) => item.productId, (item) => item.source === "regeneration" ? 1 : 0, (rows) => rows.filter((item) => item.status === "error").length).slice(0, 10),
      topPromptsUsed: aggregatePrompts(usages).sort((left, right) => right.usageCount - left.usageCount).slice(0, 10),
      topPromptsByRegeneration: aggregatePrompts(usages).sort((left, right) => right.regenerationCount - left.regenerationCount).slice(0, 10),
      fastestApprovedPrompts: aggregatePrompts(usages).filter((item) => item.approvalCount > 0 && typeof item.averageApprovalLatencyMs === "number").sort((left, right) => (left.averageApprovalLatencyMs ?? Number.MAX_SAFE_INTEGER) - (right.averageApprovalLatencyMs ?? Number.MAX_SAFE_INTEGER)).slice(0, 10),
      mostExpensiveBatches: aggregateBreakdown(usages, (item) => String(item.metadata?.batchName ?? item.batchId), (item) => item.costEstimate).slice(0, 10),
      backgroundUsage: aggregateBreakdown(usages, (item) => item.backgroundMode || "none", () => 1).slice(0, 10),
      modelPhotoUsage: aggregateBreakdown(usages, (item) => item.sourcePhotoId || "sin-foto", () => 1).slice(0, 10),
      settingsPerformance: aggregateBreakdown(
        usages,
        (item) => `${item.imageSizeLabel} | sync:${item.syncMode ? "on" : "off"} | safe:${item.enableSafetyChecker ? "on" : "off"}`,
        () => 1,
        (rows) => average(rows.map((item) => item.durationMs).filter((value): value is number => typeof value === "number"))
      ).slice(0, 10)
    }
  };
}

function aggregateSeries(
  rows: GenerationUsageRecord[],
  labelSelector: (row: GenerationUsageRecord) => string,
  valueSelector: (row: GenerationUsageRecord) => number
): AnalyticsSeriesPoint[] {
  const map = new Map<string, number>();
  for (const row of rows) {
    const key = labelSelector(row);
    map.set(key, (map.get(key) ?? 0) + valueSelector(row));
  }
  return [...map.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([label, value]) => ({ label, value }));
}

function aggregateBreakdown(
  rows: GenerationUsageRecord[],
  labelSelector: (row: GenerationUsageRecord) => string,
  valueSelector: (row: GenerationUsageRecord) => number,
  secondarySelector?: (rows: GenerationUsageRecord[]) => number
): AnalyticsBreakdownRow[] {
  const map = groupBy(rows, labelSelector);
  return Object.entries(map)
    .map(([label, bucket]) => ({
      label,
      value: sum(bucket.map(valueSelector)),
      secondaryValue: secondarySelector ? secondarySelector(bucket) : undefined
    }))
    .sort((left, right) => right.value - left.value);
}

function aggregatePrompts(rows: GenerationUsageRecord[]): AnalyticsPromptRow[] {
  const map = new Map<string, GenerationUsageRecord[]>();
  for (const row of rows) {
    const bucket = map.get(row.promptHash) ?? [];
    bucket.push(row);
    map.set(row.promptHash, bucket);
  }
  return [...map.entries()].map(([promptHash, bucket]) => {
    const usageCount = bucket.length;
    const regenerationCount = bucket.filter((item) => item.source === "regeneration").length;
    const successCount = bucket.filter((item) => item.status === "success").length;
    const errorCount = bucket.filter((item) => item.status === "error").length;
    const approvalRows = bucket.filter((item) => item.approvedAt);
    return {
      promptHash,
      promptExcerpt: bucket[0]?.promptExcerpt ?? "",
      usageCount,
      regenerationCount,
      successCount,
      errorCount,
      approvalCount: approvalRows.length,
      averageDurationMs: average(bucket.map((item) => item.durationMs).filter((value): value is number => typeof value === "number")),
      averageApprovalLatencyMs: average(approvalRows.map((item) => new Date(item.approvedAt as string).getTime() - new Date(item.startedAt).getTime()).filter((value) => Number.isFinite(value) && value >= 0)),
      totalEstimatedCost: sum(bucket.map((item) => item.costEstimate)),
      lastUsedAt: bucket.map((item) => item.startedAt).sort().at(-1) ?? ""
    };
  });
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return sum(values) / values.length;
}

function ratio(numerator: number, denominator: number): number {
  if (!denominator) {
    return 0;
  }
  return numerator / denominator;
}

function groupBy<T>(rows: T[], keySelector: (row: T) => string): Record<string, T[]> {
  return rows.reduce<Record<string, T[]>>((accumulator, row) => {
    const key = keySelector(row);
    const bucket = accumulator[key] ?? [];
    bucket.push(row);
    accumulator[key] = bucket;
    return accumulator;
  }, {});
}

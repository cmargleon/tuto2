import crypto from "crypto";
import type {
  AnalyticsDashboard,
  AnalyticsEventRecord,
  AnalyticsFilters,
  CostSnapshotRecord,
  GenerationUsageRecord
} from "../../shared/types";
import { formatImageSizeLabel, resolveCostSnapshotKey } from "../config/analytics-pricing";
import { AnalyticsRepository } from "../storage/analytics-repository";

export class AnalyticsService {
  constructor(private readonly repository: AnalyticsRepository) {}

  seedDefaultCostSnapshots(records: CostSnapshotRecord[]): void {
    this.repository.seedCostSnapshots(records);
  }

  recordEvent(event: AnalyticsEventRecord): void {
    this.repository.saveEvent(event);
  }

  startGeneration(input: {
    batchId: string;
    clientId?: string;
    productId: string;
    poseId: string;
    category: GenerationUsageRecord["category"];
    provider: string;
    providerModelId: string;
    source: GenerationUsageRecord["source"];
    systemPrompt: string;
    userPrompt: string;
    finalPrompt: string;
    providerSettings?: {
      imageSize?: GenerationUsageRecord["imageSizeLabel"] | { width: number; height: number };
      seed?: number | null;
      syncMode?: boolean;
      enableSafetyChecker?: boolean;
    };
    backgroundMode?: string;
    selectedModelId?: string;
    sourcePhotoId?: string;
    selectedPhotoIds?: string[];
    metadata?: Record<string, string | number | boolean | null>;
  }): GenerationUsageRecord {
    const now = new Date().toISOString();
    const promptHash = crypto.createHash("sha1").update(input.finalPrompt).digest("hex");
    const promptExcerpt = input.finalPrompt.slice(0, 220);
    const costSnapshotKey = resolveCostSnapshotKey(input.providerModelId);
    const costSnapshot = this.repository.getCostSnapshot(costSnapshotKey);
    const record: GenerationUsageRecord = {
      usageId: `usage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      batchId: input.batchId,
      clientId: input.clientId,
      productId: input.productId,
      poseId: input.poseId,
      category: input.category,
      provider: input.provider,
      providerModelId: input.providerModelId,
      source: input.source,
      status: "running",
      systemPrompt: input.systemPrompt,
      userPrompt: input.userPrompt,
      finalPrompt: input.finalPrompt,
      promptHash,
      promptExcerpt,
      imageSizeLabel: formatImageSizeLabel(input.providerSettings?.imageSize as never),
      seed: input.providerSettings?.seed ?? undefined,
      syncMode: Boolean(input.providerSettings?.syncMode),
      enableSafetyChecker: input.providerSettings?.enableSafetyChecker !== false,
      backgroundMode: input.backgroundMode,
      selectedModelId: input.selectedModelId,
      sourcePhotoId: input.sourcePhotoId,
      selectedPhotoIds: input.selectedPhotoIds ?? [],
      startedAt: now,
      outputCount: 0,
      costSnapshotKey: costSnapshot?.snapshotKey,
      costEstimate: costSnapshot?.unitCost ?? 0,
      currency: costSnapshot?.currency ?? "USD",
      metadata: input.metadata
    };
    this.repository.saveGenerationUsage(record);
    return record;
  }

  finishGeneration(
    usageId: string,
    patch: {
      requestId?: string;
      outputCount: number;
      providerReportedCost?: number;
      metadata?: Record<string, string | number | boolean | null>;
    }
  ): GenerationUsageRecord | null {
    const current = this.repository.getGenerationUsage(usageId);
    if (!current) {
      return null;
    }
    const finishedAt = new Date().toISOString();
    const durationMs = new Date(finishedAt).getTime() - new Date(current.startedAt).getTime();
    const next: GenerationUsageRecord = {
      ...current,
      requestId: patch.requestId ?? current.requestId,
      status: "success",
      finishedAt,
      durationMs,
      outputCount: patch.outputCount,
      providerReportedCost: patch.providerReportedCost ?? current.providerReportedCost,
      metadata: {
        ...(current.metadata ?? {}),
        ...(patch.metadata ?? {})
      }
    };
    this.repository.saveGenerationUsage(next);
    return next;
  }

  failGeneration(
    usageId: string,
    patch: {
      requestId?: string;
      errorMessage: string;
      providerReportedCost?: number;
      metadata?: Record<string, string | number | boolean | null>;
    }
  ): GenerationUsageRecord | null {
    const current = this.repository.getGenerationUsage(usageId);
    if (!current) {
      return null;
    }
    const finishedAt = new Date().toISOString();
    const durationMs = new Date(finishedAt).getTime() - new Date(current.startedAt).getTime();
    const next: GenerationUsageRecord = {
      ...current,
      requestId: patch.requestId ?? current.requestId,
      status: "error",
      finishedAt,
      durationMs,
      errorMessage: patch.errorMessage,
      providerReportedCost: patch.providerReportedCost ?? current.providerReportedCost,
      metadata: {
        ...(current.metadata ?? {}),
        ...(patch.metadata ?? {})
      }
    };
    this.repository.saveGenerationUsage(next);
    return next;
  }

  markUsageApproved(usageId: string): void {
    const current = this.repository.getGenerationUsage(usageId);
    if (!current || current.approvedAt) {
      return;
    }
    this.repository.updateGenerationUsage(usageId, {
      approvedAt: new Date().toISOString()
    });
  }

  getDashboard(filters: AnalyticsFilters): AnalyticsDashboard {
    return this.repository.getDashboard(filters);
  }

  getFilterOptions() {
    return this.repository.getFilterOptions();
  }
}

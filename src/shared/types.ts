export type ProductStatus = "pending" | "generating" | "in_review" | "approved" | "error";
export type PoseStatus = "pending" | "generating" | "ready" | "error";
export type OutputStatus = "ready" | "error";

export type FalImageSizePreset =
  | "square_hd"
  | "square"
  | "portrait_4_3"
  | "portrait_16_9"
  | "landscape_4_3"
  | "landscape_16_9"
  | "auto_2K"
  | "auto_4K";

export interface FalCustomImageSize {
  width: number;
  height: number;
}

export interface FalProviderSettings {
  modelId: string;
  imageSize: FalImageSizePreset | FalCustomImageSize;
  seed: number | null;
  syncMode: boolean;
  enableSafetyChecker: boolean;
}

export type BackgroundMode =
  | "white"
  | "bokeh"
  | "studio"
  | "exterior_natural"
  | "exterior_urbano"
  | "interior_lifestyle"
  | "custom";

export type BackgroundLightingStyle =
  | "clear_soft_daylight"
  | "warm_soft_daylight"
  | "cool_soft_daylight"
  | "studio_diffused"
  | "high_key"
  | "editorial"
  | "dramatic"
  | "overcast_soft"
  | "golden_hour";

export type BackgroundScene =
  | "none"
  | "arquitectura_moderna"
  | "calle_limpia"
  | "terraza"
  | "fachada_neutra"
  | "bosque"
  | "mar"
  | "sendero"
  | "jardin"
  | "campo"
  | "living_minimalista"
  | "estudio_creativo"
  | "cafe_elegante"
  | "vestidor"
  | "gimnasio_premium"
  | "papel_seamless"
  | "cemento_suave";

export type BackgroundProminence = "minimal" | "medium" | "editorial";
export type BackgroundContrast = "soft" | "medium" | "high";
export type BackgroundRealism = "catalogo_realista" | "campana_lifestyle";
export type BackgroundSeparation = "standard" | "strong" | "maximum";

export interface BatchBackgroundConfig {
  mode: BackgroundMode;
  bokehIntensity: number;
  lightingStyle: BackgroundLightingStyle;
  scene: BackgroundScene;
  dominantColor: string;
  backgroundProminence: BackgroundProminence;
  contrast: BackgroundContrast;
  realismLevel: BackgroundRealism;
  subjectSeparation: BackgroundSeparation;
  noPeople: boolean;
  noProps: boolean;
  noText: boolean;
  customInstructions: string;
}

export interface BatchPromptConfig {
  systemPrompt: string;
  generalPrompt: string;
  posePrompts: Record<string, string>;
  backgroundConfig: BatchBackgroundConfig;
  providerSettings: FalProviderSettings;
}

export interface ClientRecord {
  clientId: string;
  name: string;
  notes?: string;
  batchCount?: number;
  activeBatchCount?: number;
}

export type ModelGender = "female" | "male";
export type ModelAgeGroup =
  | "nino"
  | "adolescente"
  | "adulto_joven"
  | "adulto"
  | "jubilado"
  | "anciano";

export interface CatalogModelPhoto {
  photoId: string;
  modelId: string;
  filePath: string;
  sortOrder: number;
}

export interface CatalogModel {
  modelId: string;
  name: string;
  clientId?: string;
  clientName?: string;
  ageGroup?: ModelAgeGroup;
  gender: ModelGender;
  includesFullBody: boolean;
  includesFace: boolean;
  includesHands: boolean;
  includesFeet: boolean;
  includesSwimwear: boolean;
  createdAt: string;
  updatedAt: string;
  photos: CatalogModelPhoto[];
}

export interface BatchModelSelection {
  batchId: string;
  modelId: string;
  selectedPhotoIds: string[];
}

export interface ProductPromptOverrides {
  generalPrompt: string;
  posePrompts: Record<string, string>;
}

export type ProductCategory =
  | "parte_alta"
  | "parte_baja"
  | "vestido"
  | "interior_coordinado"
  | "interior_superior"
  | "interior_inferior"
  | "producto_sin_modelo";

export interface PoseInput {
  poseId: string;
  label: string;
  filePath: string;
  description: string;
  sourcePhotoId?: string;
}

export interface ProductPoseState {
  poseId: string;
  variantCount: number;
  status: PoseStatus;
  regenerateCount: number;
  providerModelId?: string;
  lastError?: string;
  promptOverride?: string;
  lastPromptUsed?: string;
  promptPreview?: string;
}

export interface GeneratedImageMetadata {
  usageId?: string;
  prompt: string;
  poseId: string;
  variantKey: string;
  provider: string;
  model: string;
  endpoint: string;
  timestamp: string;
  responseId?: string;
  costEstimate?: number;
  providerReportedCost?: number;
  notes?: string[];
}

export interface GeneratedOutput {
  outputId: string;
  usageId?: string;
  poseId: string;
  variantKey: "a";
  fileName: string;
  filePath: string;
  metadataPath: string;
  status: OutputStatus;
  error?: string;
  metadata?: GeneratedImageMetadata;
}

export interface ProductManifest {
  productId: string;
  sourceName: string;
  sku?: string;
  garmentImages: string[];
  promptOverrides?: ProductPromptOverrides;
  category: ProductCategory;
  poses: ProductPoseState[];
  outputs: GeneratedOutput[];
  approved: Record<string, string[]>;
  status: ProductStatus;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
}

export interface ProductListItem {
  productId: string;
  status: ProductStatus;
  approvedCount: number;
  totalApprovedNeeded: number;
  category: ProductCategory;
}

export interface BootstrapState {
  startedAt?: string;
  finishedAt?: string;
  status: "idle" | "running" | "completed" | "error";
  lastError?: string;
  pendingJobs: number;
  runningJobs: number;
  completedJobs: number;
  totalProducts: number;
}

export interface ActiveBatchState {
  batchId: string;
  sessionRoot: string;
  stagedInputRoot: string;
  startedAt: string;
  snapshotCount: number;
  lastSavedAt?: string;
}

export type BatchStatus = "draft" | "running" | "in_review" | "paused" | "completed" | "archived" | "error";

export interface BatchEvent {
  id: string;
  type:
    | "batch_created"
    | "batch_activated"
    | "batch_saved"
    | "batch_archived"
    | "batch_duplicated"
    | "generation_started"
    | "generation_finished"
    | "generation_failed"
    | "pose_approved"
    | "product_approved"
    | "batch_completed"
    | "pose_regenerated"
    | "model_changed"
    | "provider_model_changed"
    | "prompt_changed";
  timestamp: string;
  message: string;
  productId?: string;
  poseId?: string;
  meta?: Record<string, string | number | boolean | null>;
}

export interface BatchCounts {
  products: number;
  generating: number;
  inReview: number;
  approved: number;
  error: number;
  outputs: number;
}

export interface BatchManifest {
  batchId: string;
  name: string;
  clientId?: string;
  clientName?: string;
  status: BatchStatus;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  active: boolean;
  currentProductId?: string | null;
  promptConfig: BatchPromptConfig;
  counts: BatchCounts;
  snapshotCount: number;
  inputRoot: string;
  jobsRoot: string;
  outputRoot: string;
  approvedRoot: string;
  stateRoot: string;
  notes?: string;
  lastError?: string;
  selectedModelId?: string;
  selectedModelPhotoIds?: string[];
}

export interface BatchSnapshot {
  snapshotId: string;
  batchId: string;
  createdAt: string;
  rootPath: string;
  inputPath: string;
  outputPath: string;
  approvedPath: string;
  jobsPath: string;
  statePath: string;
  notes?: string;
}

export type JobStatus = "pending" | "running" | "completed" | "error" | "cancelled";

export interface BatchJob {
  jobId: string;
  batchId: string;
  productId: string;
  poseId: string;
  poseLabel: string;
  poseFilePath: string;
  priority: number;
  status: JobStatus;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  lastError?: string;
}

export interface BatchJobAttempt {
  attemptId: string;
  jobId: string;
  batchId: string;
  productId: string;
  poseId: string;
  status: Exclude<JobStatus, "cancelled">;
  startedAt: string;
  finishedAt?: string;
  error?: string;
}

export interface PromptHistoryEntry {
  entryId: string;
  batchId: string;
  productId: string;
  poseId: string;
  systemPrompt: string;
  userPrompt: string;
  finalPrompt: string;
  providerModelId: string;
  source: "generation" | "regeneration" | "change_model";
  createdAt: string;
}

export type AnalyticsEventType =
  | "batch_created"
  | "batch_activated"
  | "batch_saved"
  | "batch_archived"
  | "batch_duplicated"
  | "generation_started"
  | "generation_finished"
  | "generation_failed"
  | "pose_regenerated"
  | "pose_approved"
  | "product_approved"
  | "batch_completed"
  | "model_changed"
  | "provider_model_changed"
  | "prompt_changed";

export interface AnalyticsEventRecord {
  eventId: string;
  batchId: string;
  clientId?: string;
  productId?: string;
  poseId?: string;
  category?: ProductCategory;
  provider?: string;
  providerModelId?: string;
  eventType: AnalyticsEventType;
  eventSource?: "system" | "user";
  requestId?: string;
  timestamp: string;
  durationMs?: number;
  costEstimate?: number;
  providerReportedCost?: number;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface GenerationUsageRecord {
  usageId: string;
  batchId: string;
  clientId?: string;
  productId: string;
  poseId: string;
  category: ProductCategory;
  provider: string;
  providerModelId: string;
  requestId?: string;
  source: "generation" | "regeneration";
  status: "running" | "success" | "error";
  systemPrompt: string;
  userPrompt: string;
  finalPrompt: string;
  promptHash: string;
  promptExcerpt: string;
  imageSizeLabel: string;
  seed?: number | null;
  syncMode: boolean;
  enableSafetyChecker: boolean;
  backgroundMode?: string;
  selectedModelId?: string;
  sourcePhotoId?: string;
  selectedPhotoIds: string[];
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  outputCount: number;
  costSnapshotKey?: string;
  costEstimate: number;
  providerReportedCost?: number;
  currency: string;
  approvedAt?: string;
  errorMessage?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface CostSnapshotRecord {
  snapshotKey: string;
  provider: string;
  providerModelId: string;
  sizeTier: string;
  unitCost: number;
  currency: string;
  unitLabel: string;
  source: "local_estimate" | "provider_reported";
  notes?: string;
  effectiveAt: string;
}

export interface AnalyticsFilters {
  from?: string;
  to?: string;
  clientId?: string;
  providerModelId?: string;
  category?: ProductCategory | "all";
  batchId?: string;
  status?: BatchStatus | "all";
}

export interface AnalyticsKpis {
  totalGenerations: number;
  totalRegenerations: number;
  regenerationRate: number;
  totalCostEstimate: number;
  totalProviderReportedCost: number;
  currentMonthCostEstimate: number;
  averageCostPerImage: number;
  averageCostPerProduct: number;
  averageDurationMs: number;
  averageBatchDurationMs: number;
  averageApprovalTimeMs: number;
  firstPassApprovalRate: number;
  completedBatches: number;
  abandonedBatches: number;
  promptEdits: number;
}

export interface AnalyticsSeriesPoint {
  label: string;
  value: number;
  secondaryValue?: number;
}

export interface AnalyticsBreakdownRow {
  label: string;
  value: number;
  secondaryValue?: number;
  meta?: string;
}

export interface AnalyticsPromptRow {
  promptHash: string;
  promptExcerpt: string;
  usageCount: number;
  regenerationCount: number;
  successCount: number;
  errorCount: number;
  approvalCount: number;
  averageDurationMs?: number;
  averageApprovalLatencyMs?: number;
  totalEstimatedCost: number;
  lastUsedAt: string;
}

export interface AnalyticsDashboard {
  filters: AnalyticsFilters;
  kpis: AnalyticsKpis;
  charts: {
    regenerationsByDay: AnalyticsSeriesPoint[];
    costByDay: AnalyticsSeriesPoint[];
    costByClient: AnalyticsBreakdownRow[];
    usageByModel: AnalyticsBreakdownRow[];
    errorsByModel: AnalyticsBreakdownRow[];
    categoryDifficulty: AnalyticsBreakdownRow[];
  };
  tables: {
    topClientsByCost: AnalyticsBreakdownRow[];
    topClientsByFriction: AnalyticsBreakdownRow[];
    topProductsByRegenerations: AnalyticsBreakdownRow[];
    topPromptsUsed: AnalyticsPromptRow[];
    topPromptsByRegeneration: AnalyticsPromptRow[];
    fastestApprovedPrompts: AnalyticsPromptRow[];
    mostExpensiveBatches: AnalyticsBreakdownRow[];
    backgroundUsage: AnalyticsBreakdownRow[];
    modelPhotoUsage: AnalyticsBreakdownRow[];
    settingsPerformance: AnalyticsBreakdownRow[];
  };
}

export interface AnalyticsFilterOptions {
  clients: ClientRecord[];
  models: string[];
  batches: Array<{ batchId: string; name: string }>;
  categories: Array<ProductCategory>;
  statuses: Array<BatchStatus | "all">;
}

export interface ProviderImageInput {
  mimeType: string;
  dataBase64: string;
  name: string;
}

export interface GenerateVariantsInput {
  productId: string;
  category: ProductCategory;
  poseId: string;
  poseLabel: string;
  prompt: string;
  modelImages: ProviderImageInput[];
  garmentImages: ProviderImageInput[];
  poseImage: ProviderImageInput;
  variantCount: number;
  providerSettings?: FalProviderSettings;
}

export interface ProviderGeneratedImage {
  bytes: Buffer;
  mimeType: string;
  responseId?: string;
  rawText?: string;
}

export interface ImageGenerationProvider {
  readonly providerName: string;
  readonly modelName: string;
  readonly methodName: string;
  resolveProviderName(modelId?: string): string;
  resolveMethodName(modelId?: string): string;
  generateVariantsForPose(input: GenerateVariantsInput): Promise<ProviderGeneratedImage[]>;
}

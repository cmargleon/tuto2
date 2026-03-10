import type { BatchPromptConfig } from "../../shared/types";
import { BatchRepository } from "../storage/batch-repository";
import { RuntimeStateRepository } from "../storage/runtime-state-repository";

export const defaultPromptConfig: BatchPromptConfig = {
  systemPrompt: "",
  generalPrompt: "",
  posePrompts: {},
  providerSettings: {
    modelId: "fal-ai/nano-banana/edit",
    imageSize: "square_hd",
    seed: null,
    syncMode: false,
    enableSafetyChecker: true
  }
};

export class BatchPromptConfigService {
  constructor(
    private readonly batchRepository: BatchRepository,
    private readonly runtimeStateRepository: RuntimeStateRepository
  ) {}

  async get(): Promise<BatchPromptConfig> {
    const activeBatch = this.runtimeStateRepository.getActiveBatchState();
    if (activeBatch?.batchId) {
      return this.batchRepository.getPromptConfig(activeBatch.batchId) ?? defaultPromptConfig;
    }
    return this.runtimeStateRepository.getDraftPromptConfig(defaultPromptConfig);
  }

  async set(config: BatchPromptConfig): Promise<void> {
    const normalized = {
      systemPrompt: config.systemPrompt?.trim() ?? "",
      generalPrompt: config.generalPrompt.trim(),
      posePrompts: Object.fromEntries(
        Object.entries(config.posePrompts ?? {}).map(([poseId, prompt]) => [poseId, prompt.trim()])
      ),
      providerSettings: {
        modelId: config.providerSettings?.modelId?.trim() || defaultPromptConfig.providerSettings.modelId,
        imageSize: config.providerSettings?.imageSize ?? defaultPromptConfig.providerSettings.imageSize,
        seed: typeof config.providerSettings?.seed === "number" ? config.providerSettings.seed : null,
        syncMode: Boolean(config.providerSettings?.syncMode),
        enableSafetyChecker: config.providerSettings?.enableSafetyChecker ?? true
      }
    } satisfies BatchPromptConfig;

    this.runtimeStateRepository.setDraftPromptConfig(normalized);

    const activeBatch = this.runtimeStateRepository.getActiveBatchState();
    if (!activeBatch?.batchId) {
      return;
    }

    const currentBatch = this.batchRepository.getBatch(activeBatch.batchId);
    if (!currentBatch) {
      return;
    }

    this.batchRepository.saveBatch({
      ...currentBatch,
      promptConfig: normalized,
      updatedAt: new Date().toISOString()
    });
  }
}

import type { BatchPromptConfig } from "../../shared/types";
import { BatchRepository } from "../storage/batch-repository";
import { RuntimeStateRepository } from "../storage/runtime-state-repository";

export const defaultPromptConfig: BatchPromptConfig = {
  systemPrompt: "",
  generalPrompt: "",
  posePrompts: {},
  backgroundConfig: {
    mode: "white",
    bokehIntensity: 45,
    lightingStyle: "clear_soft_daylight",
    scene: "none",
    dominantColor: "white",
    backgroundProminence: "minimal",
    contrast: "soft",
    realismLevel: "catalogo_realista",
    subjectSeparation: "strong",
    noPeople: true,
    noProps: true,
    noText: true,
    customInstructions: ""
  },
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
      backgroundConfig: {
        mode: config.backgroundConfig?.mode ?? defaultPromptConfig.backgroundConfig.mode,
        bokehIntensity: Math.max(0, Math.min(100, Number(config.backgroundConfig?.bokehIntensity ?? defaultPromptConfig.backgroundConfig.bokehIntensity))),
        lightingStyle: config.backgroundConfig?.lightingStyle ?? defaultPromptConfig.backgroundConfig.lightingStyle,
        scene: config.backgroundConfig?.scene ?? defaultPromptConfig.backgroundConfig.scene,
        dominantColor: config.backgroundConfig?.dominantColor?.trim() || defaultPromptConfig.backgroundConfig.dominantColor,
        backgroundProminence: config.backgroundConfig?.backgroundProminence ?? defaultPromptConfig.backgroundConfig.backgroundProminence,
        contrast: config.backgroundConfig?.contrast ?? defaultPromptConfig.backgroundConfig.contrast,
        realismLevel: config.backgroundConfig?.realismLevel ?? defaultPromptConfig.backgroundConfig.realismLevel,
        subjectSeparation: config.backgroundConfig?.subjectSeparation ?? defaultPromptConfig.backgroundConfig.subjectSeparation,
        noPeople: Boolean(config.backgroundConfig?.noPeople),
        noProps: Boolean(config.backgroundConfig?.noProps),
        noText: config.backgroundConfig?.noText ?? true,
        customInstructions: config.backgroundConfig?.customInstructions?.trim() ?? ""
      },
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

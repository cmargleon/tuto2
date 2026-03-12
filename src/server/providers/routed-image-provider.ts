import type { GenerateVariantsInput, ImageGenerationProvider, ProviderGeneratedImage } from "../../shared/types";

export class RoutedImageProvider implements ImageGenerationProvider {
  readonly providerName = "routed";
  readonly modelName = "routed";
  readonly methodName = "routed";

  constructor(
    private readonly falProvider: ImageGenerationProvider,
    private readonly openAIProvider: ImageGenerationProvider
  ) {}

  resolveProviderName(modelId?: string): string {
    return this.selectProvider(modelId).resolveProviderName(modelId);
  }

  resolveMethodName(modelId?: string): string {
    return this.selectProvider(modelId).resolveMethodName(modelId);
  }

  async generateVariantsForPose(input: GenerateVariantsInput): Promise<ProviderGeneratedImage[]> {
    return this.selectProvider(input.providerSettings?.modelId).generateVariantsForPose(input);
  }

  private selectProvider(modelId?: string): ImageGenerationProvider {
    if (isOpenAIImageModel(modelId)) {
      return this.openAIProvider;
    }
    return this.falProvider;
  }
}

function isOpenAIImageModel(modelId?: string): boolean {
  return Boolean(modelId && modelId.trim().toLowerCase().startsWith("gpt-image-"));
}

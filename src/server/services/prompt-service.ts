import type { BatchPromptConfig, GenerateVariantsInput, ProductCategory } from "../../shared/types";

export class PromptService {
  static getDefaultSystemPrompt(): string {
    return [
      "System instructions:",
      "- Use the selected model image as the person identity reference.",
      "- Replace the model's current clothing with the garment shown in the attached garment reference image(s).",
      "- Follow the attached pose reference image as the target pose, framing and body direction.",
      "- Keep the garment faithful to the reference images in color, shape, logo placement and visible details.",
      "- Generate one final photorealistic image."
    ].join("\n");
  }

  getResolvedSystemPrompt(batchPromptConfig?: BatchPromptConfig): string {
    return batchPromptConfig?.systemPrompt?.trim() || PromptService.getDefaultSystemPrompt();
  }

  buildUserPrompt(
    _category: ProductCategory,
    poseId: string,
    _productId: string,
    _selectedModelFile: string,
    promptOverride?: string,
    options?: {
      batchPromptConfig?: BatchPromptConfig;
      productGeneralPrompt?: string;
      productPosePrompt?: string;
    }
  ): string {
    const batchPromptConfig = options?.batchPromptConfig ?? {
      systemPrompt: "",
      generalPrompt: "",
      posePrompts: {},
      providerSettings: {
        modelId: "",
        imageSize: "square_hd",
        seed: null,
        syncMode: false,
        enableSafetyChecker: true
      }
    };
    const generalPrompt = options?.productGeneralPrompt?.trim() || batchPromptConfig.generalPrompt?.trim();
    const poseExtraPrompt = options?.productPosePrompt?.trim() || batchPromptConfig.posePrompts?.[poseId]?.trim();
    const parts = [generalPrompt, poseExtraPrompt, promptOverride?.trim()].filter((value): value is string => Boolean(value && value.trim()));
    return parts.join("\n\n");
  }

  buildProviderPrompt(
    base: Omit<GenerateVariantsInput, "prompt"> & {
      selectedModelFile: string;
      promptOverride?: string;
      batchPromptConfig?: BatchPromptConfig;
      productGeneralPrompt?: string;
      productPosePrompt?: string;
    }
  ): string {
    const userPrompt = this.buildUserPrompt(
      base.category,
      base.poseId,
      base.productId,
      base.selectedModelFile,
      base.promptOverride,
      {
        batchPromptConfig: base.batchPromptConfig,
        productGeneralPrompt: base.productGeneralPrompt,
        productPosePrompt: base.productPosePrompt
      }
    );

    const hiddenDirectives = this.getResolvedSystemPrompt(base.batchPromptConfig);

    if (!userPrompt) {
      return hiddenDirectives;
    }

    return `${hiddenDirectives}\n\nUser prompt:\n${userPrompt}`;
  }

  buildEditorPrompt(
    base: {
      poseId: string;
      category: ProductCategory;
      productId: string;
      selectedModelFile: string;
      promptOverride?: string;
      batchPromptConfig?: BatchPromptConfig;
      productGeneralPrompt?: string;
      productPosePrompt?: string;
    }
  ): string {
    return this.buildProviderPrompt({
      productId: base.productId,
      category: base.category,
      poseId: base.poseId,
      poseLabel: base.poseId,
      garmentImages: [],
      poseImage: {
        mimeType: "image/jpeg",
        dataBase64: "",
        name: "pose"
      },
      variantCount: 1,
      selectedModelFile: base.selectedModelFile,
      promptOverride: base.promptOverride,
      batchPromptConfig: base.batchPromptConfig,
      productGeneralPrompt: base.productGeneralPrompt,
      productPosePrompt: base.productPosePrompt
    });
  }

  buildProviderInput(
    base: Omit<GenerateVariantsInput, "prompt"> & {
      selectedModelFile: string;
      promptOverride?: string;
      batchPromptConfig?: BatchPromptConfig;
      productGeneralPrompt?: string;
      productPosePrompt?: string;
    }
  ): GenerateVariantsInput {
    return {
      ...base,
      prompt: this.buildProviderPrompt(base)
    };
  }
}

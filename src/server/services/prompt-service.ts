import type { BatchPromptConfig, GenerateVariantsInput, ProductCategory } from "../../shared/types";

export class PromptService {
  static getDefaultSystemPrompt(): string {
    return [
      "Use the reference images with strict role separation.",
      "",
      "Image order in the request:",
      "1. The first image is always the selected model image.",
      "2. The middle image or images are always the garment reference image(s).",
      "3. The last image is always the pose reference image.",
      "",
      "Reference priority:",
      "1. The selected model image defines only the person identity.",
      "2. The garment image(s) define only the clothing/product to be worn.",
      "3. The pose image defines only the body pose, framing, camera angle and composition.",
      "",
      "Strict instructions:",
      "- Read the images using that exact order and role assignment.",
      "- Keep the identity of the final person consistent with the selected model image only.",
      "- Use the face, hair, body features, skin tone and identity from the first image only.",
      "- Do not copy or blend the face, hair, body features, skin tone or identity from the pose image.",
      "- Use the pose image only as a pose and framing guide.",
      "- Use the last image only for pose, framing, camera angle and body direction.",
      "- Do not use the last image as identity, face, hair, skin tone, clothing or styling reference.",
      "- Replace the clothing currently worn by the selected model completely with the garment shown in the garment reference image(s).",
      "- Use the garment reference image(s) only for the clothing/product and not for person identity.",
      "- Apply the garment from the middle image or images to the person from the first image.",
      "- Do not keep, reuse or mix the original clothing from the selected model image.",
      "- Do not copy clothing, accessories or styling from the pose image unless explicitly requested in the user prompt.",
      "- Preserve the garment faithfully using the garment reference image(s): same shape, proportions, color, material, texture, stitching, logo placement and visible details.",
      "- If any reference conflicts with another, identity must come from the first image, clothing must come from the garment image(s), and pose must come from the last image.",
      "- Do not merge or average identity between references.",
      "- Do not keep the original pose from the first image unless it matches the last image.",
      "- Do not keep the original clothing from the first image under any circumstance.",
      "- Keep the final image photorealistic and coherent.",
      "- Produce one final image only.",
      "",
      "What to ignore from each reference:",
      "- Ignore clothing from the selected model image.",
      "- Ignore identity from the pose image.",
      "- Ignore pose from the selected model image.",
      "- Ignore any clothing worn in the pose image."
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

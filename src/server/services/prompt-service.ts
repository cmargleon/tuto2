import type { BatchBackgroundConfig, BatchPromptConfig, GenerateVariantsInput, ProductCategory } from "../../shared/types";

export class PromptService {
  static getDefaultSystemPrompt(): string {
    return [
      "Use the reference images with strict role separation.",
      "",
      "Image order in the request:",
      "1. The first image or images are always the garment reference image(s).",
      "2. The last image is always the model image that already defines the target pose.",
      "",
      "Reference priority:",
      "1. The model image defines the person identity, pose, framing, camera angle and composition.",
      "2. The garment image(s) define only the clothing/product to be worn.",
      "",
      "Strict instructions:",
      "- Read the images using that exact order and role assignment.",
      "- Keep exactly one person in the final image.",
      "- The final person must be the same person shown in the model image.",
      "- Use the model image as the only identity reference for the person.",
      "- Use the model image as the only source for face, hair, body features and skin tone.",
      "- Do not add a second person, duplicate person, background person or blended person.",
      "- Keep the same pose, framing, camera angle, composition and body direction from the model image.",
      "- The model image must not introduce a second person or any alternate identity.",
      "- Replace the clothing currently worn by the person completely with the garment shown in the garment reference image(s).",
      "- Use the garment reference image(s) only for the clothing/product and not for identity or pose.",
      "- Apply the garment from the first image or images to the person from the last image.",
      "- Do not keep, reuse or mix the original clothing from the model image.",
      "- Do not invent extra garments, layers, accessories or alternate outfits unless explicitly requested in the user prompt.",
      "- Preserve the garment faithfully using the garment reference image(s): same shape, proportions, color, material, texture, stitching, logo placement and visible details.",
      "- If any reference conflicts with another, identity, pose and composition must come from the model image, and clothing must come from the garment image(s).",
      "- Do not merge or average identity between references.",
      "- Do not change the person identity from the model image.",
      "- Do not change the pose from the model image.",
      "- Keep the final image photorealistic and coherent.",
      "- Produce one final image only.",
      "",
      "What to ignore from each reference:",
      "- Ignore clothing from the model image.",
      "- Ignore identity, face, hair, body features, skin tone, pose and composition from the garment reference image(s)."
    ].join("\n");
  }

  getResolvedSystemPrompt(batchPromptConfig?: BatchPromptConfig): string {
    return batchPromptConfig?.systemPrompt?.trim() || PromptService.getDefaultSystemPrompt();
  }

  buildUserPrompt(
    _category: ProductCategory,
    poseId: string,
    _productId: string,
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
      posePrompts: {} as Record<string, string>,
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
        modelId: "",
        imageSize: "square_hd",
        seed: null,
        syncMode: false,
        enableSafetyChecker: true
      }
    } satisfies BatchPromptConfig;
    const generalPrompt = options?.productGeneralPrompt?.trim() || batchPromptConfig.generalPrompt?.trim();
    const poseExtraPrompt = options?.productPosePrompt?.trim() || batchPromptConfig.posePrompts?.[poseId]?.trim();
    const parts = [generalPrompt, poseExtraPrompt, promptOverride?.trim()].filter((value): value is string => Boolean(value && value.trim()));
    return parts.join("\n\n");
  }

  buildProviderPrompt(
    base: Omit<GenerateVariantsInput, "prompt"> & {
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
      base.promptOverride,
      {
        batchPromptConfig: base.batchPromptConfig,
        productGeneralPrompt: base.productGeneralPrompt,
        productPosePrompt: base.productPosePrompt
      }
    );

    const hiddenDirectives = this.getResolvedSystemPrompt(base.batchPromptConfig);
    const backgroundDirectives = this.buildBackgroundPrompt(base.batchPromptConfig?.backgroundConfig);

    if (!userPrompt && !backgroundDirectives) {
      return hiddenDirectives;
    }

    const parts = [hiddenDirectives];
    if (backgroundDirectives) {
      parts.push(backgroundDirectives);
    }
    if (userPrompt) {
      parts.push(`User prompt:\n${userPrompt}`);
    }

    return parts.join("\n\n");
  }

  buildEditorPrompt(
    base: {
      poseId: string;
      category: ProductCategory;
      productId: string;
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
      modelImages: [],
      garmentImages: [],
      poseImage: {
        mimeType: "image/jpeg",
        dataBase64: "",
        name: "pose"
      },
      variantCount: 1,
      promptOverride: base.promptOverride,
      batchPromptConfig: base.batchPromptConfig,
      productGeneralPrompt: base.productGeneralPrompt,
      productPosePrompt: base.productPosePrompt
    });
  }

  buildProviderInput(
    base: Omit<GenerateVariantsInput, "prompt"> & {
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

  buildBackgroundPrompt(backgroundConfig?: BatchBackgroundConfig): string {
    if (!backgroundConfig) {
      return "";
    }

    if (backgroundConfig.mode === "white") {
      return [
        "Background instructions:",
        "- Background mode: solid white background.",
        "- Background color: white.",
        "- Keep the background fully clean and minimal.",
        "- No scenery, environmental set pieces or lifestyle elements."
      ].join("\n");
    }

    const lines = [
      "Background instructions:",
      `- Background mode: ${this.mapBackgroundMode(backgroundConfig.mode)}.`,
      `- Scene: ${this.mapScene(backgroundConfig.scene)}.`,
      `- Lighting: ${this.mapLighting(backgroundConfig.lightingStyle)}.`,
      `- Bokeh intensity: ${Math.max(0, Math.min(100, Math.round(backgroundConfig.bokehIntensity)))}%.`,
      `- Background prominence: ${this.mapProminence(backgroundConfig.backgroundProminence)}.`,
      `- Contrast: ${this.mapContrast(backgroundConfig.contrast)}.`,
      `- Realism level: ${this.mapRealism(backgroundConfig.realismLevel)}.`,
      `- Subject separation: ${this.mapSeparation(backgroundConfig.subjectSeparation)}.`
    ];

    if (backgroundConfig.dominantColor?.trim()) {
      lines.push(`- Dominant background color: ${backgroundConfig.dominantColor.trim()}.`);
    }
    if (backgroundConfig.noPeople) {
      lines.push("- Do not place other people or silhouettes in the background.");
    }
    if (backgroundConfig.noProps) {
      lines.push("- Avoid distracting props or set pieces that compete with the garment.");
    }
    if (backgroundConfig.noText) {
      lines.push("- No text, signage, lettering or typography in the background.");
    }
    if (backgroundConfig.customInstructions?.trim()) {
      lines.push(`- Extra background direction: ${backgroundConfig.customInstructions.trim()}`);
    }

    return lines.join("\n");
  }

  private mapBackgroundMode(mode: BatchBackgroundConfig["mode"]): string {
    switch (mode) {
      case "bokeh": return "bokeh";
      case "studio": return "studio";
      case "exterior_natural": return "natural exterior";
      case "exterior_urbano": return "urban exterior";
      case "interior_lifestyle": return "lifestyle interior";
      case "custom": return "custom";
      case "white":
      default:
        return "solid white";
    }
  }

  private mapLighting(style: BatchBackgroundConfig["lightingStyle"]): string {
    const mapping: Record<BatchBackgroundConfig["lightingStyle"], string> = {
      clear_soft_daylight: "clear soft daylight",
      warm_soft_daylight: "warm soft daylight",
      cool_soft_daylight: "cool soft daylight",
      studio_diffused: "diffused studio light",
      high_key: "high-key studio light",
      editorial: "editorial light",
      dramatic: "dramatic light",
      overcast_soft: "soft overcast light",
      golden_hour: "golden hour light"
    };
    return mapping[style];
  }

  private mapScene(scene: BatchBackgroundConfig["scene"]): string {
    const mapping: Record<BatchBackgroundConfig["scene"], string> = {
      none: "none",
      arquitectura_moderna: "modern architecture",
      calle_limpia: "clean street",
      terraza: "terrace",
      fachada_neutra: "neutral facade",
      bosque: "forest",
      mar: "sea",
      sendero: "trail",
      jardin: "garden",
      campo: "field",
      living_minimalista: "minimalist living room",
      estudio_creativo: "creative studio",
      cafe_elegante: "elegant cafe",
      vestidor: "dressing room",
      gimnasio_premium: "premium gym",
      papel_seamless: "seamless paper backdrop",
      cemento_suave: "soft concrete backdrop"
    };
    return mapping[scene];
  }

  private mapProminence(value: BatchBackgroundConfig["backgroundProminence"]): string {
    return {
      minimal: "minimal and secondary",
      medium: "balanced",
      editorial: "editorial but still secondary to the subject"
    }[value];
  }

  private mapContrast(value: BatchBackgroundConfig["contrast"]): string {
    return {
      soft: "soft",
      medium: "medium",
      high: "high"
    }[value];
  }

  private mapRealism(value: BatchBackgroundConfig["realismLevel"]): string {
    return {
      catalogo_realista: "realistic catalog photography",
      campana_lifestyle: "lifestyle campaign photography"
    }[value];
  }

  private mapSeparation(value: BatchBackgroundConfig["subjectSeparation"]): string {
    return {
      standard: "standard",
      strong: "strong",
      maximum: "maximum"
    }[value];
  }
}

import type { BatchBackgroundConfig, BatchPromptConfig, GenerateVariantsInput, ProductCategory } from "../../shared/types";

export class PromptService {
  static getDefaultSystemPrompt(): string {
    return [
      "Use the two reference images with strict role separation.",
      "",
      "Image order:",
      "1. The first image is the garment reference image.",
      "2. The second image is the model image and defines the person identity, pose, framing, camera angle, composition and scene.",
      "",
      "Task:",
      "Replace the clothing worn by the person in the second image with the garment shown in the first image.",
      "",
      "Identity and pose rules:",
      "- Keep exactly one person in the final image.",
      "- Preserve the exact same person from image 2.",
      "- Preserve the face, hair, skin tone, body shape and age appearance.",
      "- Preserve the same pose, body direction, camera angle and composition from image 2.",
      "",
      "Garment rules:",
      "- Use image 1 only as the clothing reference.",
      "- Completely replace the clothing worn by the model in image 2 with the garment from image 1.",
      "- Do not keep, reuse or blend the original clothing from image 2.",
      "- Do not invent extra garments, layers or accessories unless they are clearly part of the garment shown in image 1.",
      "- Preserve the garment faithfully including shape, cut, proportions, color, material, fabric texture, stitching, patterns, logos and visible design details.",
      "- Adapt the garment naturally to the model’s body and pose.",
      "",
      "Framing and face visibility rules:",
      "- The model’s face must be fully visible in the final image.",
      "- The entire head must remain inside the frame.",
      "- Do not crop the forehead, chin, or sides of the head.",
      "- Maintain a small safety margin above the head to avoid cutting the face.",
      "- If necessary, slightly adjust or zoom out the framing to keep the full face visible.",
      "- Never crop the eyes, nose or mouth.",
      "",
      "Scene rules:",
      "- Keep the background similar to image 2 unless minor adjustments are needed for realism.",
      "- Do not add other people or silhouettes.",
      "- Do not add distracting objects.",
      "",
      "Image quality:",
      "- Photorealistic result.",
      "- Natural lighting and shadows.",
      "- Clean catalog-style fashion photography.",
      "",
      "Ignore:",
      "- Ignore the clothing worn in image 2.",
      "- Ignore identity, pose and background from image 1.",
      "",
      "Priority rules:",
      "1. Person identity and pose come from image 2.",
      "2. Clothing comes from image 1.",
      "",
      "Output:",
      "Produce one final photorealistic image with the model wearing the garment."
    ].join("\\n");
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
    const visiblePrompt = this.buildEditorPrompt({
      category: base.category,
      poseId: base.poseId,
      productId: base.productId,
      promptOverride: base.promptOverride,
      batchPromptConfig: base.batchPromptConfig,
      productGeneralPrompt: base.productGeneralPrompt,
      productPosePrompt: base.productPosePrompt
    });
    const backgroundDirectives = this.buildBackgroundPrompt(base.batchPromptConfig?.backgroundConfig);

    if (!backgroundDirectives) {
      return visiblePrompt;
    }

    return [visiblePrompt, backgroundDirectives].join("\n\n");
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
    if (base.promptOverride?.trim()) {
      return base.promptOverride.trim();
    }

    const systemPrompt = this.getResolvedSystemPrompt(base.batchPromptConfig);
    const userPrompt = this.buildUserPrompt(
      base.category,
      base.poseId,
      base.productId,
      undefined,
      {
        batchPromptConfig: base.batchPromptConfig,
        productGeneralPrompt: base.productGeneralPrompt,
        productPosePrompt: base.productPosePrompt
      }
    );

    if (!userPrompt) {
      return systemPrompt;
    }

    return [systemPrompt, `User prompt:\n${userPrompt}`].join("\n\n");
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

import type {
  FalProviderSettings,
  GenerateVariantsInput,
  ImageGenerationProvider,
  ProviderGeneratedImage
} from "../../shared/types";
import { config } from "../config";
import { logger } from "../utils/logger";

interface OpenAIImageDataItem {
  b64_json?: string;
  url?: string;
}

interface OpenAIImagesResponse {
  created?: number;
  data?: OpenAIImageDataItem[];
}

export class OpenAIImageProvider implements ImageGenerationProvider {
  readonly providerName = "openai";
  readonly modelName = "gpt-image-1.5";
  readonly methodName = "POST /v1/images/edits";

  resolveProviderName(): string {
    return this.providerName;
  }

  resolveMethodName(): string {
    return this.methodName;
  }

  async generateVariantsForPose(input: GenerateVariantsInput): Promise<ProviderGeneratedImage[]> {
    if (!config.openaiApiKey) {
      throw new Error("Missing OPENAI_API_KEY in environment.");
    }

    const modelId = input.providerSettings?.modelId || this.modelName;
    const images = [
      ...input.modelImages,
      ...input.garmentImages,
      input.poseImage
    ];

    logger.info("OpenAI image edit request prepared.", {
      productId: input.productId,
      poseId: input.poseId,
      model: modelId,
      imageCount: images.length,
      promptPreview: input.prompt.slice(0, 500)
    });

    const form = new FormData();
    form.append("model", modelId);
    form.append("prompt", input.prompt);
    form.append("size", mapOpenAISize(input.providerSettings));
    form.append("n", String(Math.max(1, input.variantCount)));

    for (const image of images) {
      const blob = new Blob([Buffer.from(image.dataBase64, "base64")], { type: image.mimeType });
      form.append("image[]", blob, image.name);
    }

    const response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openaiApiKey}`
      },
      body: form
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`OpenAI image edit failed: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ""}`);
    }

    const payload = await response.json() as OpenAIImagesResponse;
    const imagesData = payload.data ?? [];
    if (imagesData.length < input.variantCount) {
      throw new Error(`OpenAI returned ${imagesData.length} image(s), expected at least ${input.variantCount}.`);
    }

    return Promise.all(imagesData.slice(0, input.variantCount).map(async (item) => {
      const bytes = item.b64_json
        ? Buffer.from(item.b64_json, "base64")
        : item.url
          ? await fetchImageBytes(item.url)
          : null;
      if (!bytes) {
        throw new Error("OpenAI did not return an image payload.");
      }
      return {
        bytes,
        mimeType: "image/png"
      } satisfies ProviderGeneratedImage;
    }));
  }
}

function mapOpenAISize(settings?: FalProviderSettings): string {
  const imageSize = settings?.imageSize;
  if (!imageSize) {
    return "1024x1024";
  }
  if (typeof imageSize === "object") {
    return imageSize.width >= imageSize.height ? "1536x1024" : "1024x1536";
  }
  switch (imageSize) {
    case "landscape_4_3":
    case "landscape_16_9":
    case "auto_4K":
      return "1536x1024";
    case "portrait_4_3":
    case "portrait_16_9":
      return "1024x1536";
    case "auto_2K":
      return "auto";
    case "square":
    case "square_hd":
    default:
      return "1024x1024";
  }
}

async function fetchImageBytes(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download OpenAI output from ${url}: ${response.status} ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

import { fal } from "@fal-ai/client";
import type {
  GenerateVariantsInput,
  ImageGenerationProvider,
  ProviderGeneratedImage
} from "../../shared/types";
import { config } from "../config";
import { logger } from "../utils/logger";

interface FalImageResult {
  url: string;
  content_type?: string;
}

interface FalEditResponse {
  images?: FalImageResult[];
}

export class FalSeedreamImageProvider implements ImageGenerationProvider {
  readonly providerName = "fal-ai";
  readonly modelName = config.falModel;
  readonly methodName = "fal.subscribe";
  private configured = false;
  private readonly uploadCache = new Map<string, string>();

  async generateVariantsForPose(input: GenerateVariantsInput): Promise<ProviderGeneratedImage[]> {
    this.ensureConfigured();
    const imageUrls = await buildImageUrls(input, this.uploadCache);
    const modelId = input.providerSettings?.modelId || this.modelName;
    logger.info("fal.ai request prepared.", {
      productId: input.productId,
      poseId: input.poseId,
      model: modelId,
      imageCount: imageUrls.length,
      promptPreview: input.prompt.slice(0, 500)
    });
    const result = await fal.subscribe(modelId, {
      input: {
        prompt: input.prompt,
        image_urls: imageUrls,
        image_size: input.providerSettings?.imageSize ?? "square_hd",
        num_images: input.variantCount,
        max_images: 1,
        enable_safety_checker: input.providerSettings?.enableSafetyChecker ?? true,
        sync_mode: input.providerSettings?.syncMode ?? false,
        ...(typeof input.providerSettings?.seed === "number" ? { seed: input.providerSettings.seed } : {})
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === "IN_PROGRESS") {
          for (const log of update.logs ?? []) {
            logger.info(`[fal] ${log.message}`);
          }
        }
      }
    });

    const data = result.data as FalEditResponse;
    const images = data.images ?? [];
    if (images.length < input.variantCount) {
      throw new Error(`fal.ai returned ${images.length} image(s), expected at least ${input.variantCount}.`);
    }

    return Promise.all(images.slice(0, input.variantCount).map(async (image) => ({
      bytes: await fetchImageBytes(image.url),
      mimeType: image.content_type ?? "image/png",
      responseId: result.requestId
    })));
  }

  private ensureConfigured(): void {
    if (this.configured) {
      return;
    }
    if (!config.falKey) {
      throw new Error("Missing FAL_KEY in environment.");
    }
    fal.config({
      credentials: config.falKey
    });
    this.configured = true;
  }
}

async function buildImageUrls(input: GenerateVariantsInput, uploadCache: Map<string, string>): Promise<string[]> {
  const urls = [
    ...(await Promise.all(input.modelImages.map((image) => uploadReferenceImage(image, uploadCache)))),
    ...(await Promise.all(input.garmentImages.map((image) => uploadReferenceImage(image, uploadCache)))),
    await uploadReferenceImage(input.poseImage, uploadCache)
  ];

  if (urls.length > 10) {
    throw new Error(`fal.ai Seedream 4.5 edit accepts up to 10 input images; received ${urls.length}.`);
  }

  return urls;
}

async function uploadReferenceImage(
  image: GenerateVariantsInput["garmentImages"][number],
  uploadCache: Map<string, string>
): Promise<string> {
  const cacheKey = `${image.name}:${image.dataBase64.length}`;
  const cached = uploadCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const blob = new Blob([Buffer.from(image.dataBase64, "base64")], { type: image.mimeType });
  const uploadedUrl = await fal.storage.upload(blob);
  uploadCache.set(cacheKey, uploadedUrl);
  return uploadedUrl;
}

async function fetchImageBytes(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download fal.ai output from ${url}: ${response.status} ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

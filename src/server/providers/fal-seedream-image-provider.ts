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

interface FalSingleImageResponse {
  image?: FalImageResult;
}

export class FalSeedreamImageProvider implements ImageGenerationProvider {
  readonly providerName = "fal-ai";
  readonly modelName = config.falModel;
  readonly methodName = "fal.subscribe";
  private configured = false;
  private readonly uploadCache = new Map<string, string>();

  resolveProviderName(): string {
    return this.providerName;
  }

  resolveMethodName(): string {
    return this.methodName;
  }

  async generateVariantsForPose(input: GenerateVariantsInput): Promise<ProviderGeneratedImage[]> {
    this.ensureConfigured();
    const modelId = input.providerSettings?.modelId || this.modelName;
    if (isVirtualTryOnModel(modelId)) {
      return this.generateVirtualTryOn(modelId, input);
    }

    const imageUrls = await buildImageUrls(input, this.uploadCache);
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

    return mapFalImagesResponse(result, input.variantCount);
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

  private async generateVirtualTryOn(modelId: string, input: GenerateVariantsInput): Promise<ProviderGeneratedImage[]> {
    const { garmentUrl, personUrl } = await buildVirtualTryOnImageUrls(input, this.uploadCache);
    logger.info("fal.ai virtual try-on request prepared.", {
      productId: input.productId,
      poseId: input.poseId,
      model: modelId,
      garmentUrl,
      personUrl
    });

    const falInput = buildVirtualTryOnInput(modelId, input, garmentUrl, personUrl);
    const result = await fal.subscribe(modelId, {
      input: falInput,
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === "IN_PROGRESS") {
          for (const log of update.logs ?? []) {
            logger.info(`[fal] ${log.message}`);
          }
        }
      }
    });

    return mapFalImagesResponse(result, input.variantCount);
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

async function buildVirtualTryOnImageUrls(
  input: GenerateVariantsInput,
  uploadCache: Map<string, string>
): Promise<{ garmentUrl: string; personUrl: string }> {
  const garment = input.garmentImages[0];
  if (!garment) {
    throw new Error("Virtual try-on requires at least one garment reference image.");
  }
  return {
    garmentUrl: await uploadReferenceImage(garment, uploadCache),
    personUrl: await uploadReferenceImage(input.poseImage, uploadCache)
  };
}

function buildVirtualTryOnInput(
  modelId: string,
  input: GenerateVariantsInput,
  garmentUrl: string,
  personUrl: string
): Record<string, unknown> {
  if (modelId === "fal-ai/image-apps-v2/virtual-try-on") {
    return {
      person_image_url: personUrl,
      garment_image_url: garmentUrl,
      preserve_pose: true,
      num_samples: Math.max(1, input.variantCount)
    };
  }

  if (modelId === "fal-ai/fashn/tryon/v1.6" || modelId === "fal-ai/fashn/tryon/v1.5") {
    return {
      model_image: personUrl,
      garment_image: garmentUrl,
      category: "auto",
      mode: "quality",
      num_samples: Math.max(1, Math.min(4, input.variantCount)),
      garment_photo_type: "auto"
    };
  }

  if (modelId === "fal-ai/kling/v1-5/kolors-virtual-try-on") {
    return {
      person_image_url: personUrl,
      garment_image_url: garmentUrl
    };
  }

  if (modelId === "fal-ai/flux-2-lora-gallery/virtual-tryon") {
    return {
      prompt: input.prompt,
      image_urls: [personUrl, garmentUrl],
      num_images: Math.max(1, Math.min(4, input.variantCount))
    };
  }

  throw new Error(`Unsupported virtual try-on model: ${modelId}`);
}

function isVirtualTryOnModel(modelId: string): boolean {
  return [
    "fal-ai/image-apps-v2/virtual-try-on",
    "fal-ai/fashn/tryon/v1.6",
    "fal-ai/fashn/tryon/v1.5",
    "fal-ai/kling/v1-5/kolors-virtual-try-on",
    "fal-ai/flux-2-lora-gallery/virtual-tryon"
  ].includes(modelId);
}

async function mapFalImagesResponse(
  result: Awaited<ReturnType<typeof fal.subscribe>>,
  variantCount: number
): Promise<ProviderGeneratedImage[]> {
  const data = result.data as FalEditResponse & FalSingleImageResponse;
  const images = data.images ?? (data.image ? [data.image] : []);
  if (images.length < Math.max(1, variantCount)) {
    throw new Error(`fal.ai returned ${images.length} image(s), expected at least ${variantCount}.`);
  }

  return Promise.all(images.slice(0, variantCount).map(async (image) => ({
    bytes: await fetchImageBytes(image.url),
    mimeType: image.content_type ?? "image/png",
    responseId: result.requestId
  })));
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

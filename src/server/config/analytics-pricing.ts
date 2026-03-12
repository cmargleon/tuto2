import type { CostSnapshotRecord, FalProviderSettings } from "../../shared/types";

const EFFECTIVE_AT = "2026-03-11T00:00:00.000Z";

export const defaultCostSnapshots: CostSnapshotRecord[] = [
  {
    snapshotKey: "fal-ai/bytedance/seedream/v4.5/edit:standard",
    provider: "fal-ai",
    providerModelId: "fal-ai/bytedance/seedream/v4.5/edit",
    sizeTier: "standard",
    unitCost: 0.04,
    currency: "USD",
    unitLabel: "image",
    source: "local_estimate",
    notes: "Estimacion local basada en pricing publico de fal.ai.",
    effectiveAt: EFFECTIVE_AT
  },
  {
    snapshotKey: "fal-ai/nano-banana/edit:standard",
    provider: "fal-ai",
    providerModelId: "fal-ai/nano-banana/edit",
    sizeTier: "standard",
    unitCost: 0.08,
    currency: "USD",
    unitLabel: "image",
    source: "local_estimate",
    notes: "Estimacion local basada en pricing publico de fal.ai.",
    effectiveAt: EFFECTIVE_AT
  },
  {
    snapshotKey: "fal-ai/nano-banana-pro/edit:standard",
    provider: "fal-ai",
    providerModelId: "fal-ai/nano-banana-pro/edit",
    sizeTier: "standard",
    unitCost: 0.15,
    currency: "USD",
    unitLabel: "image",
    source: "local_estimate",
    notes: "Estimacion local basada en pricing publico de fal.ai.",
    effectiveAt: EFFECTIVE_AT
  },
  {
    snapshotKey: "fal-ai/gemini-3.1-flash-image-preview/edit:standard",
    provider: "fal-ai",
    providerModelId: "fal-ai/gemini-3.1-flash-image-preview/edit",
    sizeTier: "standard",
    unitCost: 0.08,
    currency: "USD",
    unitLabel: "image",
    source: "local_estimate",
    notes: "Estimacion local basada en pricing publico de fal.ai.",
    effectiveAt: EFFECTIVE_AT
  },
  {
    snapshotKey: "gpt-image-1.5:standard",
    provider: "openai",
    providerModelId: "gpt-image-1.5",
    sizeTier: "standard",
    unitCost: 0.04,
    currency: "USD",
    unitLabel: "image",
    source: "local_estimate",
    notes: "Estimacion local basada en pricing publico de OpenAI para imagen media.",
    effectiveAt: EFFECTIVE_AT
  }
];

export function resolveCostSnapshotKey(modelId: string): string {
  return `${modelId}:standard`;
}

export function formatImageSizeLabel(imageSize: FalProviderSettings["imageSize"] | undefined): string {
  if (!imageSize) {
    return "default";
  }
  if (typeof imageSize === "string") {
    return imageSize;
  }
  return `${imageSize.width}x${imageSize.height}`;
}

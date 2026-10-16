/** Parameter count from a name like "qwen3:8b". Untagged models count as 0. */
export function modelSize(model: string): number {
  const match = model.toLowerCase().match(/(\d+(?:\.\d+)?)b\b/);
  return match ? Number(match[1]) : 0;
}

/** Credits charged per generated token. Heavier models cost more. */
export function creditsPerToken(model: string): number {
  const billion = modelSize(model);
  if (billion >= 65) return 12;
  if (billion >= 20) return 4;
  if (billion >= 7) return 2;
  return 1;
}

/** Smallest model we still ship; only for machines that cannot hold 4B. */
export const FALLBACK_MODEL = "qwen3:1.7b";
/** What most machines get. Fits an 8 GB Mac and follows a short menu reliably. */
export const DEFAULT_MODEL = "qwen3:4b";
/** Offered on machines with headroom; the size most local-LLM users actually run. */
export const ROOMY_MODEL = "qwen3:8b";

/** Pick a model tier from installed RAM. Owners can still override in config. */
export function recommendedModel(memoryGb: number): string {
  if (memoryGb >= 16) return ROOMY_MODEL;
  if (memoryGb >= 8) return DEFAULT_MODEL;
  return FALLBACK_MODEL;
}

/** Of the models a machine offers, the one we'd rather use for world choices. */
export function preferredModel(models: string[]): string | undefined {
  const chat = models.filter((m) => !/embed|vision|vl|coder/i.test(m));
  return [...chat].sort((a, b) => modelSize(b) - modelSize(a))[0] ?? models[0];
}

/**
 * World beats stay on the roomy tier or smaller. Larger models are for asks
 * someone chose. Biggest first, so a caller can step down when a hold does
 * not fit. Embeddings and coder models are left out; they are not for prose.
 */
export function worldModels(models: string[]): string[] {
  const chat = models.filter((m) => !/embed|vision|vl|coder/i.test(m) && modelSize(m) <= modelSize(ROOMY_MODEL));
  return [...new Set(chat)].sort((a, b) => modelSize(b) - modelSize(a));
}

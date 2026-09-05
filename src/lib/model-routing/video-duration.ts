export const VIDEO_DURATION_PRESETS = [4, 5, 6, 8, 10] as const;

function admittedMaximum(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

/**
 * Projects the product's duration presets through the selected model's signed
 * quantity ceiling. A model whose ceiling is below every preset still exposes
 * its exact ceiling so the UI never offers an impossible request.
 */
export function supportedVideoDurations(
  maxQuantity: number | null | undefined,
): number[] {
  const maximum = admittedMaximum(maxQuantity);
  if (maximum === null) return [...VIDEO_DURATION_PRESETS];

  const admitted = VIDEO_DURATION_PRESETS.filter(
    (duration) => duration <= maximum,
  );
  return admitted.length > 0 ? admitted : [maximum];
}

/** Keeps restored or cross-model duration state on an option the UI exposes. */
export function clampVideoDuration(
  requested: number,
  maxQuantity: number | null | undefined,
): number {
  const options = supportedVideoDurations(maxQuantity);
  if (options.includes(requested)) return requested;
  if (!Number.isFinite(requested) || requested <= options[0]!) return options[0]!;

  let selected = options[0]!;
  for (const option of options) {
    if (option > requested) break;
    selected = option;
  }
  return selected;
}

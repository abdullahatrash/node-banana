/**
 * Provider-declared 9:16 outputs commonly round dimensions to codec-friendly
 * multiples. Accept at most one percent relative drift while still pinning the
 * exact provider dimensions in the qualification.
 */
export function isNineSixteenDimensions(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false;
  const expectedCrossProduct = height * 9;
  return Math.abs(width * 16 - expectedCrossProduct) / expectedCrossProduct <= 0.01;
}

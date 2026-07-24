export const ARTIFACT_TEXT_MEDIA_TYPE = "text/plain; charset=utf-8";
export const ARTIFACT_MAX_TEXT_BYTES = 1_048_576;
export const ARTIFACT_MAX_IMAGE_BYTES = 52_428_800;
export const ARTIFACT_ID_MIN_LENGTH = 1;
export const ARTIFACT_ID_MAX_LENGTH = 200;
export const ARTIFACT_ID_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
export const ARTIFACT_IDEMPOTENCY_KEY_MIN_LENGTH = 8;
export const ARTIFACT_IDEMPOTENCY_KEY_MAX_LENGTH = 200;
export const ARTIFACT_IDEMPOTENCY_CONTROL_PATTERN =
  /[\u0000-\u001f\u007f]/;
export const ARTIFACT_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
export const ARTIFACT_MEDIA_TYPE_MIN_LENGTH = 3;
export const ARTIFACT_MEDIA_TYPE_MAX_LENGTH = 120;
export const ARTIFACT_MEDIA_TYPE_PATTERN =
  /^[A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+(?:\s*;\s*charset=utf-8)?$/;

export function normalizeArtifactMediaType(value: string): string {
  return value.trim().toLowerCase().replace(/\s*;\s*/g, "; ");
}

export function isValidArtifactId(value: string): boolean {
  return ARTIFACT_ID_PATTERN.test(value);
}

export function isValidArtifactIdempotencyKey(value: string): boolean {
  return (
    value.length >= ARTIFACT_IDEMPOTENCY_KEY_MIN_LENGTH &&
    value.length <= ARTIFACT_IDEMPOTENCY_KEY_MAX_LENGTH &&
    !ARTIFACT_IDEMPOTENCY_CONTROL_PATTERN.test(value)
  );
}

export function isValidArtifactDigest(value: string): boolean {
  return ARTIFACT_DIGEST_PATTERN.test(value);
}

export function isValidArtifactMediaType(value: string): boolean {
  return (
    value.length >= ARTIFACT_MEDIA_TYPE_MIN_LENGTH &&
    value.length <= ARTIFACT_MEDIA_TYPE_MAX_LENGTH &&
    ARTIFACT_MEDIA_TYPE_PATTERN.test(value)
  );
}

export const PUBLISHING_DELIVERY_EFFECT_KEY_PATTERN =
  /^publishing-effect:v1:[A-Za-z0-9_-]{1,200}:[A-Za-z0-9_-]{1,200}(?::g(?:[2-9]|[1-9][0-9]+))?$/;

export const PUBLISHING_DELIVERY_OUTBOX_DEDUPE_KEY_PATTERN =
  /^publishing-delivery:[A-Za-z0-9_-]{1,200}:[A-Za-z0-9_-]{1,200}:v[1-9][0-9]*$/;

function identity(value: string, label: string): string {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(value)) {
    throw new TypeError(`${label} is invalid.`);
  }
  return value;
}

export function publishingDeliveryEffectKey(
  workspaceId: string,
  deliveryId: string,
  generation = 1,
): string {
  if (!Number.isSafeInteger(generation) || generation < 1) {
    throw new TypeError("Publishing Delivery effect generation is invalid.");
  }
  const base = `publishing-effect:v1:${identity(workspaceId, "Workspace ID")}:${identity(deliveryId, "Delivery ID")}`;
  return generation === 1 ? base : `${base}:g${generation}`;
}

export function publishingDeliveryOutboxDedupeKey(
  workspaceId: string,
  deliveryId: string,
  generation: number,
): string {
  if (!Number.isSafeInteger(generation) || generation < 1) {
    throw new TypeError("Publishing Delivery outbox generation is invalid.");
  }
  return `publishing-delivery:${identity(workspaceId, "Workspace ID")}:${identity(deliveryId, "Delivery ID")}:v${generation}`;
}

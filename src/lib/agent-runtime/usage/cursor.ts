import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIX = "uc1";
const ORDER = "recorded_at_desc_id_desc";
const MAX_LENGTH = 2_048;

export interface UsageCursorPosition {
  recordedAt: Date;
  id: string;
}

export interface UsageCursorCodec {
  seal(input: {
    workspaceId: string;
    callerId: string;
    collection: string;
    filterDigest: string;
    position: UsageCursorPosition;
  }): string;
  open(input: {
    cursor: string;
    workspaceId: string;
    callerId: string;
    collection: string;
    filterDigest: string;
  }): UsageCursorPosition;
}

interface Key { id: string; key: Uint8Array }
interface Payload {
  v: 1;
  workspaceId: string;
  callerId: string;
  collection: string;
  filterDigest: string;
  order: typeof ORDER;
  recordedAt: string;
  id: string;
}

export class InvalidUsageCursorError extends Error {
  constructor() {
    super("Usage cursor is invalid or unavailable.");
    this.name = "InvalidUsageCursorError";
  }
}

function decode(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new InvalidUsageCursorError();
  const result = Buffer.from(value, "base64url");
  if (!result.length || result.toString("base64url") !== value) throw new InvalidUsageCursorError();
  return result;
}

function key(value: Uint8Array): Buffer {
  const result = Buffer.from(value);
  if (result.length !== 32) throw new TypeError("Usage cursor keys must be 32 bytes.");
  return result;
}

export class AesGcmUsageCursorCodec implements UsageCursorCodec {
  constructor(private readonly readKeys: () => { active: Key; all: Key[] }) {}

  seal(input: Parameters<UsageCursorCodec["seal"]>[0]): string {
    const { active } = this.readKeys();
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(active.id)) throw new TypeError("Usage cursor key ID is invalid.");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key(active.key), iv);
    cipher.setAAD(Buffer.from(`${PREFIX}.${active.id}`));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify({
      v: 1,
      workspaceId: input.workspaceId,
      callerId: input.callerId,
      collection: input.collection,
      filterDigest: input.filterDigest,
      order: ORDER,
      recordedAt: input.position.recordedAt.toISOString(),
      id: input.position.id,
    } satisfies Payload)), cipher.final()]);
    return [PREFIX, active.id, iv.toString("base64url"), encrypted.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
  }

  open(input: Parameters<UsageCursorCodec["open"]>[0]): UsageCursorPosition {
    try {
      if (!input.cursor || input.cursor.length > MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(input.cursor)) throw new InvalidUsageCursorError();
      const [prefix, keyId, ivValue, encryptedValue, tagValue, extra] = input.cursor.split(".");
      if (prefix !== PREFIX || !keyId || !ivValue || !encryptedValue || !tagValue || extra !== undefined) throw new InvalidUsageCursorError();
      const selected = this.readKeys().all.find((candidate) => candidate.id === keyId);
      if (!selected) throw new InvalidUsageCursorError();
      const iv = decode(ivValue);
      const encrypted = decode(encryptedValue);
      const tag = decode(tagValue);
      if (iv.length !== 12 || tag.length !== 16) throw new InvalidUsageCursorError();
      const decipher = createDecipheriv("aes-256-gcm", key(selected.key), iv);
      decipher.setAAD(Buffer.from(`${PREFIX}.${keyId}`));
      decipher.setAuthTag(tag);
      const parsed = JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8")) as Partial<Payload>;
      if (
        parsed.v !== 1 || parsed.order !== ORDER ||
        parsed.workspaceId !== input.workspaceId || parsed.callerId !== input.callerId ||
        parsed.collection !== input.collection || parsed.filterDigest !== input.filterDigest ||
        typeof parsed.recordedAt !== "string" || Number.isNaN(new Date(parsed.recordedAt).getTime()) ||
        typeof parsed.id !== "string" || !parsed.id || parsed.id.length > 200
      ) throw new InvalidUsageCursorError();
      return { recordedAt: new Date(parsed.recordedAt), id: parsed.id };
    } catch (error) {
      if (error instanceof InvalidUsageCursorError) throw error;
      throw new InvalidUsageCursorError();
    }
  }
}

export function usageCursorKeysFromEnvironment(): { active: Key; all: Key[] } {
  const configured = process.env.USAGE_CURSOR_KEYS?.trim() || process.env.ARTIFACT_CURSOR_KEYS?.trim();
  if (!configured) throw new Error("USAGE_CURSOR_KEYS is required.");
  const all = configured.split(",").map((entry) => {
    const separator = entry.indexOf(":");
    if (separator <= 0) throw new Error("USAGE_CURSOR_KEYS is invalid.");
    const value = { id: entry.slice(0, separator), key: decode(entry.slice(separator + 1)) };
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(value.id) || value.key.length !== 32) throw new Error("USAGE_CURSOR_KEYS is invalid.");
    return value;
  });
  if (new Set(all.map((entry) => entry.id)).size !== all.length) throw new Error("USAGE_CURSOR_KEYS contains duplicate key IDs.");
  return { active: all[0]!, all };
}

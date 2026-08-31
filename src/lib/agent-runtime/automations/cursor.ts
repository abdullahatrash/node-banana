import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { AutomationCursorCodec, AutomationCursorKind, AutomationCursorPosition } from "./types";

const PREFIX = "auc1";
const MAX_LENGTH = 2_048;

interface Payload {
  v: 1;
  workspaceId: string;
  principalId: string;
  kind: AutomationCursorKind;
  scopeId: string;
  filterDigest: string;
  primary: string;
  id: string;
}

export interface AutomationCursorKey { id: string; key: Uint8Array }
export class InvalidAutomationCursorError extends Error {
  constructor() {
    super("Automation cursor is invalid or unavailable.");
    this.name = "InvalidAutomationCursorError";
  }
}

function keyBuffer(key: Uint8Array): Buffer {
  const value = Buffer.from(key);
  if (value.length !== 32) throw new TypeError("Automation cursor keys must be 32 bytes.");
  return value;
}

function decode(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new InvalidAutomationCursorError();
  const result = Buffer.from(value, "base64url");
  if (!result.length || result.toString("base64url") !== value) throw new InvalidAutomationCursorError();
  return result;
}

export class AesGcmAutomationCursorCodec implements AutomationCursorCodec {
  constructor(private readonly readKeys: () => { active: AutomationCursorKey; all: AutomationCursorKey[] }) {}

  seal(input: Omit<Payload, "v"> & { position: AutomationCursorPosition }): string {
    const { active } = this.readKeys();
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(active.id)) throw new TypeError("Automation cursor key ID is invalid.");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", keyBuffer(active.key), iv);
    cipher.setAAD(Buffer.from(`${PREFIX}.${active.id}`));
    const plaintext = Buffer.from(JSON.stringify({
      v: 1,
      workspaceId: input.workspaceId,
      principalId: input.principalId,
      kind: input.kind,
      scopeId: input.scopeId,
      filterDigest: input.filterDigest,
      primary: input.position.primary,
      id: input.position.id,
    } satisfies Payload));
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return [PREFIX, active.id, iv.toString("base64url"), encrypted.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
  }

  open(input: Omit<Payload, "v" | "primary" | "id"> & { cursor: string }): AutomationCursorPosition {
    try {
      if (!input.cursor || input.cursor.length > MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(input.cursor)) throw new InvalidAutomationCursorError();
      const [prefix, keyId, ivText, bodyText, tagText, extra] = input.cursor.split(".");
      if (prefix !== PREFIX || !keyId || !ivText || !bodyText || !tagText || extra !== undefined) throw new InvalidAutomationCursorError();
      const key = this.readKeys().all.find((entry) => entry.id === keyId);
      if (!key) throw new InvalidAutomationCursorError();
      const iv = decode(ivText); const body = decode(bodyText); const tag = decode(tagText);
      if (iv.length !== 12 || tag.length !== 16) throw new InvalidAutomationCursorError();
      const decipher = createDecipheriv("aes-256-gcm", keyBuffer(key.key), iv);
      decipher.setAAD(Buffer.from(`${PREFIX}.${keyId}`)); decipher.setAuthTag(tag);
      const payload = JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8")) as Partial<Payload>;
      if (payload.v !== 1 || payload.workspaceId !== input.workspaceId || payload.principalId !== input.principalId || payload.kind !== input.kind || payload.scopeId !== input.scopeId || payload.filterDigest !== input.filterDigest || typeof payload.primary !== "string" || typeof payload.id !== "string" || !payload.id) throw new InvalidAutomationCursorError();
      return { primary: payload.primary, id: payload.id };
    } catch (error) {
      if (error instanceof InvalidAutomationCursorError) throw error;
      throw new InvalidAutomationCursorError();
    }
  }
}

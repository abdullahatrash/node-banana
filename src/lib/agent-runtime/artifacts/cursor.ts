import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import type {
  ArtifactCursorCodec,
  ArtifactListPosition,
} from "./types";

const CURSOR_PREFIX = "ac1";
const CURSOR_ORDER = "created_at_desc_id_desc";
const MAX_CURSOR_LENGTH = 2_048;

interface CursorPayload {
  v: 1;
  workspaceId: string;
  principalId: string;
  filterDigest: string;
  order: typeof CURSOR_ORDER;
  createdAt: string;
  id: string;
}

export interface ArtifactCursorKey {
  id: string;
  key: Uint8Array;
}

export class InvalidArtifactCursorError extends Error {
  constructor() {
    super("Artifact cursor is invalid or unavailable.");
    this.name = "InvalidArtifactCursorError";
  }
}

function keyBuffer(key: Uint8Array): Buffer {
  const value = Buffer.from(key);
  if (value.length !== 32) throw new TypeError("Artifact cursor keys must be 32 bytes.");
  return value;
}

function decodeCanonicalBase64Url(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new InvalidArtifactCursorError();
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length === 0 || decoded.toString("base64url") !== value) {
    throw new InvalidArtifactCursorError();
  }
  return decoded;
}

function parsePayload(value: string): CursorPayload {
  const parsed = JSON.parse(value) as Partial<CursorPayload>;
  if (
    parsed.v !== 1 ||
    typeof parsed.workspaceId !== "string" ||
    typeof parsed.principalId !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(parsed.filterDigest ?? "") ||
    parsed.order !== CURSOR_ORDER ||
    typeof parsed.createdAt !== "string" ||
    Number.isNaN(new Date(parsed.createdAt).getTime()) ||
    typeof parsed.id !== "string" ||
    !parsed.id ||
    parsed.id.length > 200
  ) {
    throw new InvalidArtifactCursorError();
  }
  return parsed as CursorPayload;
}

export class AesGcmArtifactCursorCodec implements ArtifactCursorCodec {
  constructor(
    private readonly readKeys: () => {
      active: ArtifactCursorKey;
      all: ArtifactCursorKey[];
    },
  ) {}

  seal(input: {
    workspaceId: string;
    principalId: string;
    filterDigest: string;
    position: ArtifactListPosition;
  }): string {
    const { active } = this.readKeys();
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(active.id)) {
      throw new TypeError("Artifact cursor key ID is invalid.");
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", keyBuffer(active.key), iv);
    cipher.setAAD(Buffer.from(`${CURSOR_PREFIX}.${active.id}`));
    const plaintext = Buffer.from(
      JSON.stringify({
        v: 1,
        workspaceId: input.workspaceId,
        principalId: input.principalId,
        filterDigest: input.filterDigest,
        order: CURSOR_ORDER,
        createdAt: input.position.createdAt.toISOString(),
        id: input.position.id,
      } satisfies CursorPayload),
    );
    const encrypted = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
    ]);
    return [
      CURSOR_PREFIX,
      active.id,
      iv.toString("base64url"),
      encrypted.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
    ].join(".");
  }

  open(input: {
    cursor: string;
    workspaceId: string;
    principalId: string;
    filterDigest: string;
  }): ArtifactListPosition {
    try {
      if (
        !input.cursor ||
        input.cursor.length > MAX_CURSOR_LENGTH ||
        /[\u0000-\u001f\u007f]/.test(input.cursor)
      ) {
        throw new InvalidArtifactCursorError();
      }
      const [prefix, keyId, ivValue, ciphertextValue, tagValue, extra] =
        input.cursor.split(".");
      if (
        prefix !== CURSOR_PREFIX ||
        !keyId ||
        !ivValue ||
        !ciphertextValue ||
        !tagValue ||
        extra !== undefined
      ) {
        throw new InvalidArtifactCursorError();
      }
      const key = this.readKeys().all.find((candidate) => candidate.id === keyId);
      if (!key) throw new InvalidArtifactCursorError();
      const iv = decodeCanonicalBase64Url(ivValue);
      const ciphertext = decodeCanonicalBase64Url(ciphertextValue);
      const tag = decodeCanonicalBase64Url(tagValue);
      if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
        throw new InvalidArtifactCursorError();
      }
      const decipher = createDecipheriv(
        "aes-256-gcm",
        keyBuffer(key.key),
        iv,
      );
      decipher.setAAD(Buffer.from(`${CURSOR_PREFIX}.${keyId}`));
      decipher.setAuthTag(tag);
      const payload = parsePayload(
        Buffer.concat([
          decipher.update(ciphertext),
          decipher.final(),
        ]).toString("utf8"),
      );
      if (
        payload.workspaceId !== input.workspaceId ||
        payload.principalId !== input.principalId ||
        payload.filterDigest !== input.filterDigest
      ) {
        throw new InvalidArtifactCursorError();
      }
      return {
        createdAt: new Date(payload.createdAt),
        id: payload.id,
      };
    } catch (error) {
      if (error instanceof InvalidArtifactCursorError) throw error;
      throw new InvalidArtifactCursorError();
    }
  }
}

export function artifactCursorKeysFromEnvironment(): {
  active: ArtifactCursorKey;
  all: ArtifactCursorKey[];
} {
  const configured = process.env.ARTIFACT_CURSOR_KEYS?.trim();
  if (!configured) {
    throw new Error(
      "ARTIFACT_CURSOR_KEYS is required and must contain kid:base64url-key entries.",
    );
  }
  const all = configured.split(",").map((entry) => {
    const separator = entry.indexOf(":");
    if (separator <= 0) throw new Error("ARTIFACT_CURSOR_KEYS is invalid.");
    const id = entry.slice(0, separator);
    const encodedKey = entry.slice(separator + 1);
    let key: Buffer;
    try {
      key = decodeCanonicalBase64Url(encodedKey);
    } catch {
      throw new Error("ARTIFACT_CURSOR_KEYS is invalid.");
    }
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(id) || key.length !== 32) {
      throw new Error("ARTIFACT_CURSOR_KEYS is invalid.");
    }
    return { id, key };
  });
  if (new Set(all.map((entry) => entry.id)).size !== all.length) {
    throw new Error("ARTIFACT_CURSOR_KEYS contains duplicate key IDs.");
  }
  return { active: all[0], all };
}

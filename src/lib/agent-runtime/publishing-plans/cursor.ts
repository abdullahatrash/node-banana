import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import type {
  PublishingPlanCursorCodec,
  PublishingPlanListPosition,
} from "./types";

const PREFIX = "pprc1";
const ORDER = "created_at_desc_id_desc";
const MAX_LENGTH = 2_048;

interface Key {
  id: string;
  key: Uint8Array;
}

interface Payload {
  v: 1;
  workspaceId: string;
  principalId: string;
  filterDigest: string;
  order: typeof ORDER;
  createdAt: string;
  id: string;
}

export class InvalidPublishingPlanCursorError extends Error {
  constructor() {
    super("Publishing Plan cursor is invalid or unavailable.");
    this.name = "InvalidPublishingPlanCursorError";
  }
}

function decode(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new InvalidPublishingPlanCursorError();
  }
  const result = Buffer.from(value, "base64url");
  if (!result.length || result.toString("base64url") !== value) {
    throw new InvalidPublishingPlanCursorError();
  }
  return result;
}

function keyBytes(value: Uint8Array): Buffer {
  const result = Buffer.from(value);
  if (result.length !== 32) {
    throw new TypeError("Publishing Plan cursor keys must be 32 bytes.");
  }
  return result;
}

export class AesGcmPublishingPlanCursorCodec
  implements PublishingPlanCursorCodec
{
  constructor(
    private readonly readKeys: () => { active: Key; all: Key[] },
  ) {}

  seal(input: Parameters<PublishingPlanCursorCodec["seal"]>[0]): string {
    const { active } = this.readKeys();
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(active.id)) {
      throw new TypeError("Publishing Plan cursor key ID is invalid.");
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", keyBytes(active.key), iv);
    cipher.setAAD(Buffer.from(`${PREFIX}.${active.id}`));
    const payload: Payload = {
      v: 1,
      workspaceId: input.workspaceId,
      principalId: input.principalId,
      filterDigest: input.filterDigest,
      order: ORDER,
      createdAt: input.position.createdAt.toISOString(),
      id: input.position.id,
    };
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(payload)),
      cipher.final(),
    ]);
    return [
      PREFIX,
      active.id,
      iv.toString("base64url"),
      encrypted.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
    ].join(".");
  }

  open(input: Parameters<PublishingPlanCursorCodec["open"]>[0]): PublishingPlanListPosition {
    try {
      if (
        !input.cursor ||
        input.cursor.length > MAX_LENGTH ||
        /[\u0000-\u001f\u007f]/.test(input.cursor)
      ) {
        throw new InvalidPublishingPlanCursorError();
      }
      const [prefix, keyId, ivValue, encryptedValue, tagValue, extra] =
        input.cursor.split(".");
      if (
        prefix !== PREFIX ||
        !keyId ||
        !ivValue ||
        !encryptedValue ||
        !tagValue ||
        extra !== undefined
      ) {
        throw new InvalidPublishingPlanCursorError();
      }
      const selected = this.readKeys().all.find((item) => item.id === keyId);
      if (!selected) throw new InvalidPublishingPlanCursorError();
      const iv = decode(ivValue);
      const encrypted = decode(encryptedValue);
      const tag = decode(tagValue);
      if (iv.length !== 12 || tag.length !== 16) {
        throw new InvalidPublishingPlanCursorError();
      }
      const decipher = createDecipheriv(
        "aes-256-gcm",
        keyBytes(selected.key),
        iv,
      );
      decipher.setAAD(Buffer.from(`${PREFIX}.${keyId}`));
      decipher.setAuthTag(tag);
      const parsed = JSON.parse(
        Buffer.concat([
          decipher.update(encrypted),
          decipher.final(),
        ]).toString("utf8"),
      ) as Partial<Payload>;
      if (
        parsed.v !== 1 ||
        parsed.order !== ORDER ||
        parsed.workspaceId !== input.workspaceId ||
        parsed.principalId !== input.principalId ||
        parsed.filterDigest !== input.filterDigest ||
        typeof parsed.createdAt !== "string" ||
        Number.isNaN(new Date(parsed.createdAt).getTime()) ||
        typeof parsed.id !== "string" ||
        !/^[A-Za-z0-9_-]{1,200}$/.test(parsed.id)
      ) {
        throw new InvalidPublishingPlanCursorError();
      }
      return { createdAt: new Date(parsed.createdAt), id: parsed.id };
    } catch (error) {
      if (error instanceof InvalidPublishingPlanCursorError) throw error;
      throw new InvalidPublishingPlanCursorError();
    }
  }
}

export function publishingPlanCursorKeysFromEnvironment(): {
  active: Key;
  all: Key[];
} {
  const configured = process.env.PUBLISHING_PLAN_CURSOR_KEYS?.trim();
  if (!configured) throw new Error("PUBLISHING_PLAN_CURSOR_KEYS is required.");
  const all = configured.split(",").map((entry) => {
    const separator = entry.indexOf(":");
    if (separator <= 0) {
      throw new Error("PUBLISHING_PLAN_CURSOR_KEYS is invalid.");
    }
    const value = {
      id: entry.slice(0, separator),
      key: decode(entry.slice(separator + 1)),
    };
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(value.id) || value.key.length !== 32) {
      throw new Error("PUBLISHING_PLAN_CURSOR_KEYS is invalid.");
    }
    return value;
  });
  if (new Set(all.map((item) => item.id)).size !== all.length) {
    throw new Error("PUBLISHING_PLAN_CURSOR_KEYS contains duplicate key IDs.");
  }
  return { active: all[0]!, all };
}

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import type { WorkflowRunEventCursorCodec } from "./types";

const PREFIX = "wre1";
const ORDER = "sequence_asc";
const MAX_LENGTH = 2_048;

interface Payload {
  v: 1;
  workspaceId: string;
  principalId: string;
  workflowId: string;
  runId: string;
  order: typeof ORDER;
  afterSequence: number;
}

export interface WorkflowRunCursorKey {
  id: string;
  key: Uint8Array;
}

export class InvalidWorkflowRunCursorError extends Error {
  constructor() {
    super("Workflow Run event cursor is invalid or unavailable.");
    this.name = "InvalidWorkflowRunCursorError";
  }
}

function keyBuffer(key: Uint8Array): Buffer {
  const value = Buffer.from(key);
  if (value.length !== 32) {
    throw new TypeError("Workflow Run cursor keys must be 32 bytes.");
  }
  return value;
}

function decode(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new InvalidWorkflowRunCursorError();
  }
  const decoded = Buffer.from(value, "base64url");
  if (!decoded.length || decoded.toString("base64url") !== value) {
    throw new InvalidWorkflowRunCursorError();
  }
  return decoded;
}

function decodeConfiguredKey(value: string): Buffer {
  try {
    return decode(value);
  } catch {
    throw new Error("WORKFLOW_RUN_CURSOR_KEYS is invalid.");
  }
}

function payload(value: string): Payload {
  const parsed = JSON.parse(value) as Partial<Payload>;
  if (
    parsed.v !== 1 ||
    typeof parsed.workspaceId !== "string" ||
    typeof parsed.principalId !== "string" ||
    typeof parsed.workflowId !== "string" ||
    typeof parsed.runId !== "string" ||
    parsed.order !== ORDER ||
    !Number.isSafeInteger(parsed.afterSequence) ||
    (parsed.afterSequence ?? -1) < 0
  ) {
    throw new InvalidWorkflowRunCursorError();
  }
  return parsed as Payload;
}

export class AesGcmWorkflowRunEventCursorCodec
  implements WorkflowRunEventCursorCodec
{
  constructor(
    private readonly readKeys: () => {
      active: WorkflowRunCursorKey;
      all: WorkflowRunCursorKey[];
    },
  ) {}

  seal(input: Parameters<WorkflowRunEventCursorCodec["seal"]>[0]): string {
    if (!Number.isSafeInteger(input.afterSequence) || input.afterSequence < 0) {
      throw new TypeError("Workflow Run event sequence is invalid.");
    }
    const { active } = this.readKeys();
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(active.id)) {
      throw new TypeError("Workflow Run cursor key ID is invalid.");
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", keyBuffer(active.key), iv);
    cipher.setAAD(Buffer.from(`${PREFIX}.${active.id}`));
    const encrypted = Buffer.concat([
      cipher.update(
        JSON.stringify({
          v: 1,
          workspaceId: input.workspaceId,
          principalId: input.principalId,
          workflowId: input.workflowId,
          runId: input.runId,
          order: ORDER,
          afterSequence: input.afterSequence,
        } satisfies Payload),
      ),
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

  open(input: Parameters<WorkflowRunEventCursorCodec["open"]>[0]): number {
    try {
      if (
        !input.cursor ||
        input.cursor.length > MAX_LENGTH ||
        /[\u0000-\u001f\u007f]/.test(input.cursor)
      ) {
        throw new InvalidWorkflowRunCursorError();
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
        throw new InvalidWorkflowRunCursorError();
      }
      const key = this.readKeys().all.find((candidate) => candidate.id === keyId);
      if (!key) throw new InvalidWorkflowRunCursorError();
      const iv = decode(ivValue);
      const encrypted = decode(encryptedValue);
      const tag = decode(tagValue);
      if (iv.length !== 12 || tag.length !== 16 || !encrypted.length) {
        throw new InvalidWorkflowRunCursorError();
      }
      const decipher = createDecipheriv("aes-256-gcm", keyBuffer(key.key), iv);
      decipher.setAAD(Buffer.from(`${PREFIX}.${keyId}`));
      decipher.setAuthTag(tag);
      const opened = payload(
        Buffer.concat([
          decipher.update(encrypted),
          decipher.final(),
        ]).toString("utf8"),
      );
      if (
        opened.workspaceId !== input.workspaceId ||
        opened.principalId !== input.principalId ||
        opened.workflowId !== input.workflowId ||
        opened.runId !== input.runId
      ) {
        throw new InvalidWorkflowRunCursorError();
      }
      return opened.afterSequence;
    } catch (error) {
      if (error instanceof InvalidWorkflowRunCursorError) throw error;
      throw new InvalidWorkflowRunCursorError();
    }
  }
}

export function workflowRunCursorKeysFromEnvironment(): {
  active: WorkflowRunCursorKey;
  all: WorkflowRunCursorKey[];
} {
  const configured = process.env.WORKFLOW_RUN_CURSOR_KEYS?.trim();
  if (!configured) {
    throw new Error(
      "WORKFLOW_RUN_CURSOR_KEYS is required and must contain kid:base64url-key entries.",
    );
  }
  const all = configured.split(",").map((entry) => {
    const separator = entry.indexOf(":");
    if (separator <= 0) {
      throw new Error("WORKFLOW_RUN_CURSOR_KEYS is invalid.");
    }
    const id = entry.slice(0, separator);
    const key = decodeConfiguredKey(entry.slice(separator + 1));
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(id) || key.length !== 32) {
      throw new Error("WORKFLOW_RUN_CURSOR_KEYS is invalid.");
    }
    return { id, key };
  });
  if (new Set(all.map(({ id }) => id)).size !== all.length) {
    throw new Error("WORKFLOW_RUN_CURSOR_KEYS contains duplicate key IDs.");
  }
  return { active: all[0], all };
}

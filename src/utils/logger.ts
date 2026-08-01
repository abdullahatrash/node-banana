/**
 * Fail-closed operational logger.
 *
 * Canonical workflow/provider records own rich data. This sink intentionally
 * stores only low-cardinality diagnostics and bounded counters so prompts,
 * content, credentials, URLs, paths, provider bodies, and thrown Errors cannot
 * become a second data plane.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogCategory =
  | "workflow.start"
  | "workflow.end"
  | "workflow.error"
  | "workflow.validation"
  | "node.execution"
  | "node.error"
  | "api.gemini"
  | "api.openai"
  | "api.llm"
  | "api.error"
  | "file.save"
  | "file.load"
  | "file.error"
  | "connection.validation"
  | "state.change"
  | "system";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  category: LogCategory;
  message: string;
  context?: Record<string, unknown>;
}

export interface LogSession {
  sessionId: string;
  startTime: string;
  endTime?: string;
  entries: LogEntry[];
}

const SAFE_MESSAGE = "Operational event.";
const MAX_CONTEXT_KEYS = 32;
const MAX_CONTEXT_DEPTH = 4;

const SENSITIVE_KEY =
  /(prompt|content|media|image|audio|video|credential|header|cookie|token|key|url|uri|path|body|error|message|stack|cause|secret|auth|password|payload|response|request|file|directory)/i;

const SAFE_SCALAR_KEYS = new Set([
  "attempt",
  "batchSize",
  "bytes",
  "configured",
  "count",
  "deletedCount",
  "delayMs",
  "duration",
  "durationMs",
  "edgeCount",
  "enabled",
  "exists",
  "height",
  "index",
  "inputCount",
  "isDataURI",
  "levelIndex",
  "maxAttempts",
  "nodeCount",
  "outputCount",
  "processed",
  "replayed",
  "retryCount",
  "size",
  "sizeBytes",
  "sizeKB",
  "skipped",
  "statusCode",
  "success",
  "total",
  "totalCount",
  "totalFiles",
  "uploaded",
  "valid",
  "width",
]);

const SAFE_ENUM_VALUES: Readonly<Record<string, ReadonlySet<string>>> = {
  action: new Set(["read", "write", "delete", "create", "update", "publish", "retry", "resume"]),
  category: new Set(["authorization", "provider", "persistence", "quota", "budget", "artifact", "runtime", "validation"]),
  mode: new Set(["sync", "async", "manual", "automatic", "create", "edit"]),
  operation: new Set(["workflow", "text", "image", "audio", "video", "storage", "publish", "refresh", "cleanup"]),
  outcome: new Set(["succeeded", "failed", "unknown", "denied", "waiting"]),
  phase: new Set(["admission", "planning", "execution", "settlement", "reconciliation", "storage"]),
  platform: new Set(["facebook", "instagram", "mastodon", "bluesky"]),
  provider: new Set(["google", "openai", "anthropic", "kie", "internal", "unknown"]),
  reason: new Set(["capacity", "policy", "suspension", "provider", "persistence", "validation", "unknown"]),
  status: new Set(["accepted", "pending", "processing", "waiting", "completed", "published", "failed", "cancelled", "rejected", "active", "disabled", "revoked", "expired", "unknown"]),
};

function safeCode(value: string): string | undefined {
  return /^[A-Z][A-Z0-9_]{0,79}$/.test(value) ? value : undefined;
}

function sanitizeValue(
  key: string,
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (SENSITIVE_KEY.test(key) || depth > MAX_CONTEXT_DEPTH) return undefined;
  if (typeof value === "boolean") {
    return SAFE_SCALAR_KEYS.has(key) ? value : undefined;
  }
  if (typeof value === "number") {
    return SAFE_SCALAR_KEYS.has(key) &&
      Number.isFinite(value) &&
      Math.abs(value) <= Number.MAX_SAFE_INTEGER
      ? value
      : undefined;
  }
  if (typeof value === "string") {
    if (key === "code") return safeCode(value);
    return SAFE_ENUM_VALUES[key]?.has(value) ? value : undefined;
  }
  if (!value || typeof value !== "object" || seen.has(value)) return undefined;
  seen.add(value);

  if (Array.isArray(value)) {
    const sanitized = value
      .slice(0, MAX_CONTEXT_KEYS)
      .map((item) => sanitizeValue(key, item, depth + 1, seen))
      .filter((item) => item !== undefined);
    return sanitized.length > 0 ? sanitized : undefined;
  }

  const sanitized: Record<string, unknown> = {};
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const nestedKey of Object.keys(descriptors).slice(0, MAX_CONTEXT_KEYS)) {
    const descriptor = descriptors[nestedKey];
    if (!("value" in descriptor)) continue;
    const nested = sanitizeValue(
      nestedKey,
      descriptor.value,
      depth + 1,
      seen,
    );
    if (nested !== undefined) sanitized[nestedKey] = nested;
  }
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function sanitizeContext(context: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  const seen = new WeakSet<object>([context]);
  const descriptors = Object.getOwnPropertyDescriptors(context);
  for (const key of Object.keys(descriptors).slice(0, MAX_CONTEXT_KEYS)) {
    const descriptor = descriptors[key];
    if (!("value" in descriptor)) continue;
    const value = sanitizeValue(key, descriptor.value, 0, seen);
    if (value !== undefined) sanitized[key] = value;
  }
  return sanitized;
}

class Logger {
  private currentSession: LogSession | null = null;

  async startSession(): Promise<string> {
    const sessionId = this.generateSessionId();
    const startTime = new Date().toISOString();
    this.currentSession = { sessionId, startTime, entries: [] };
    this.log("info", "system", "Session started");
    return sessionId;
  }

  async endSession(): Promise<void> {
    if (!this.currentSession) return;
    this.currentSession.endTime = new Date().toISOString();
    this.log("info", "system", "Session ended");
    this.currentSession = null;
  }

  getCurrentSession(): LogSession | null {
    return this.currentSession;
  }

  log(
    level: LogLevel,
    category: LogCategory,
    _message: string,
    context?: Record<string, unknown>,
    _error?: Error,
  ): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      category,
      message: SAFE_MESSAGE,
    };
    if (context) {
      const safeContext = sanitizeContext(context);
      if (Object.keys(safeContext).length > 0) entry.context = safeContext;
    }
    if (this.currentSession) this.currentSession.entries.push(entry);

    const consoleMethod =
      level === "error" ? "error" : level === "warn" ? "warn" : "log";
    console[consoleMethod](entry);
  }

  info(category: LogCategory, message: string, context?: Record<string, unknown>): void {
    this.log("info", category, message, context);
  }

  warn(category: LogCategory, message: string, context?: Record<string, unknown>): void {
    this.log("warn", category, message, context);
  }

  error(
    category: LogCategory,
    message: string,
    context?: Record<string, unknown>,
    error?: Error,
  ): void {
    this.log("error", category, message, context, error);
  }

  getSessionId(): string | null {
    return this.currentSession?.sessionId ?? null;
  }

  private generateSessionId(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
    const random = Math.random().toString(36).substring(2, 8);
    return `exec-${timestamp}-${random}`;
  }
}

export const logger = new Logger();

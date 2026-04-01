import { isRecord } from "@/lib/social/utils";

const ALLOWED_TRIGGER_SOURCES = new Set(["schedule", "manual", "event"]);
const LOOP_BLOCKED_TRIGGER_SOURCE = "automation";
const SUPPORTED_ACTION_TYPE = "create_social_post";

export const MIN_REPEAT_INTERVAL_SECONDS = 60;
export const MAX_REPEAT_INTERVAL_SECONDS = 60 * 60 * 24 * 30;
export const MAX_ALLOWED_RUNS = 1000;
export const MAX_AUTOMATION_CHAIN_LENGTH = 25;
export const MAX_AUTOMATION_CHAIN_DELAY_SECONDS = 60 * 60 * 24 * 7;

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readOptionalInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) ? parsed : undefined;
  }
  return undefined;
}

function includesAutomationTriggerSource(value: unknown): boolean {
  const str = readString(value);
  if (str) {
    return str.toLowerCase() === LOOP_BLOCKED_TRIGGER_SOURCE;
  }

  if (Array.isArray(value)) {
    return value.some(
      (item) =>
        typeof item === "string" &&
        item.trim().toLowerCase() === LOOP_BLOCKED_TRIGGER_SOURCE,
    );
  }

  return false;
}

function hasNestedAutomationContext(payload: Record<string, unknown>): boolean {
  if (
    readString(payload.automationId) ||
    readString(payload.automationRunId) ||
    readString(payload.automationRuleId) ||
    readString(payload.sourceAutomationRuleId) ||
    readString(payload.sourceAutomationTaskId)
  ) {
    return true;
  }

  if (isRecord(payload.automation)) {
    return true;
  }

  const workflowContext = payload.workflowContext;
  return isRecord(workflowContext) ? hasNestedAutomationContext(workflowContext) : false;
}

function collectChainLengthCandidates(payload: Record<string, unknown>): number[] {
  const values: number[] = [];
  const directCandidates = [
    payload.chainLength,
    payload.maxChainLength,
    payload.position,
  ];
  for (const candidate of directCandidates) {
    const parsed = readOptionalInt(candidate);
    if (parsed !== undefined) {
      values.push(parsed);
    }
  }

  if (isRecord(payload.chain)) {
    const chainCandidates = [
      payload.chain.length,
      payload.chain.chainLength,
      payload.chain.maxChainLength,
      payload.chain.position,
    ];
    for (const candidate of chainCandidates) {
      const parsed = readOptionalInt(candidate);
      if (parsed !== undefined) {
        values.push(parsed);
      }
    }
  }

  return values;
}

function collectDelayCandidates(payload: Record<string, unknown>): number[] {
  const values: number[] = [];
  const directCandidates = [
    payload.delaySeconds,
    payload.cumulativeDelaySeconds,
    payload.totalDelaySeconds,
  ];
  for (const candidate of directCandidates) {
    const parsed = readOptionalInt(candidate);
    if (parsed !== undefined) {
      values.push(parsed);
    }
  }

  if (isRecord(payload.chain)) {
    const chainCandidates = [
      payload.chain.delaySeconds,
      payload.chain.cumulativeDelaySeconds,
      payload.chain.totalDelaySeconds,
    ];
    for (const candidate of chainCandidates) {
      const parsed = readOptionalInt(candidate);
      if (parsed !== undefined) {
        values.push(parsed);
      }
    }
  }

  return values;
}

function validateChainBounds(payload: Record<string, unknown>): string | null {
  for (const chainLength of collectChainLengthCandidates(payload)) {
    if (chainLength < 0) {
      return "Chain metadata values cannot be negative.";
    }
    if (chainLength > MAX_AUTOMATION_CHAIN_LENGTH) {
      return `Chain metadata exceeds max length of ${MAX_AUTOMATION_CHAIN_LENGTH}.`;
    }
  }

  for (const delaySeconds of collectDelayCandidates(payload)) {
    if (delaySeconds < 0) {
      return "delaySeconds cannot be negative.";
    }
    if (delaySeconds > MAX_AUTOMATION_CHAIN_DELAY_SECONDS) {
      return `delaySeconds exceeds max allowed ${MAX_AUTOMATION_CHAIN_DELAY_SECONDS} seconds.`;
    }
  }

  return null;
}

export function validateAutomationRulePayload(input: {
  triggerSource: string;
  repeatIntervalSeconds?: number | null;
  maxRuns?: number | null;
  triggerFilters?: Record<string, unknown> | null;
  actionType?: string | null;
  actionConfig?: Record<string, unknown> | null;
  enforceKnownTriggerSource?: boolean;
}): string | null {
  if (input.triggerSource === LOOP_BLOCKED_TRIGGER_SOURCE) {
    return 'triggerSource "automation" is blocked to prevent self-trigger loops.';
  }

  if (
    (input.enforceKnownTriggerSource ?? true) &&
    !ALLOWED_TRIGGER_SOURCES.has(input.triggerSource)
  ) {
    return `triggerSource must be one of: ${Array.from(ALLOWED_TRIGGER_SOURCES).join(", ")}.`;
  }

  if (
    input.repeatIntervalSeconds !== undefined &&
    input.repeatIntervalSeconds !== null &&
    (input.repeatIntervalSeconds < MIN_REPEAT_INTERVAL_SECONDS ||
      input.repeatIntervalSeconds > MAX_REPEAT_INTERVAL_SECONDS)
  ) {
    return `repeatIntervalSeconds must be between ${MIN_REPEAT_INTERVAL_SECONDS} and ${MAX_REPEAT_INTERVAL_SECONDS}.`;
  }

  if (
    input.maxRuns !== undefined &&
    input.maxRuns !== null &&
    (input.maxRuns < 1 || input.maxRuns > MAX_ALLOWED_RUNS)
  ) {
    return `maxRuns must be between 1 and ${MAX_ALLOWED_RUNS}.`;
  }

  if (
    input.triggerFilters &&
    includesAutomationTriggerSource(input.triggerFilters.triggerSource)
  ) {
    return 'triggerFilters.triggerSource cannot include "automation".';
  }

  if ((input.actionType ?? SUPPORTED_ACTION_TYPE) !== SUPPORTED_ACTION_TYPE) {
    return `actionType must be "${SUPPORTED_ACTION_TYPE}".`;
  }

  if (!input.actionConfig) {
    return null;
  }

  if (
    includesAutomationTriggerSource(input.actionConfig.triggerSource) ||
    includesAutomationTriggerSource(input.actionConfig.source)
  ) {
    return 'actionConfig cannot set trigger/source to "automation".';
  }

  if (hasNestedAutomationContext(input.actionConfig)) {
    return "Nested automation context is not allowed in actionConfig.";
  }

  return validateChainBounds(input.actionConfig);
}

export function validateAutomationTaskPayload(input: {
  runIndex: number;
  payload?: Record<string, unknown> | null;
}): string | null {
  if (!Number.isInteger(input.runIndex) || input.runIndex < 1) {
    return "runIndex must be a positive integer.";
  }

  if (input.runIndex > MAX_ALLOWED_RUNS) {
    return `runIndex exceeds max allowed ${MAX_ALLOWED_RUNS}.`;
  }

  if (!input.payload) {
    return null;
  }

  if (
    includesAutomationTriggerSource(input.payload.triggerSource) ||
    includesAutomationTriggerSource(input.payload.source)
  ) {
    return 'Task input cannot set trigger/source to "automation".';
  }

  if (hasNestedAutomationContext(input.payload)) {
    return "Nested automation context is not allowed in task input.";
  }

  return validateChainBounds(input.payload);
}

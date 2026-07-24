/**
 * Compatibility re-export for the runtime implementation. Reusable capability
 * and transport types are owned by the central `src/types` domain hub.
 */
export type {
  CapabilityApprovalContract,
  CapabilityCliIo,
  CapabilityCliOptions,
  CapabilityDefinition,
  CapabilityDispatchContext,
  CapabilityDispatcherPort,
  CapabilityEffect,
  CapabilityError,
  CapabilityErrorCategory,
  CapabilityErrorContract,
  CapabilityHandlerContext,
  CapabilityIdentity,
  CapabilityIdempotencyPolicy,
  CapabilityInvocation,
  CapabilityLifecycle,
  CapabilityLifecycleStatus,
  CapabilityRegistration,
  CapabilityRegistryReader,
  CapabilityResponse,
  CapabilityResult,
  CapabilityWarning,
  JsonSchema,
  McpCapabilityTool,
} from "@/types/capabilities";

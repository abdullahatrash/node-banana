import { canonicalDigest } from "@/lib/agent-tools/canonical";
import {
  canonicalProviderAdapterContractDigest,
  executeProviderEffect,
  observeProviderEffect,
  type ProviderAdapter,
  type ProviderAdapterContract,
  type ProviderCredentialMaterial,
  type ProviderOutcome,
} from "../runs/provider-adapter";
import type { PublishingDeliveryRecord } from "./types";

export type PublishingPlatformBoundaryFailure = Readonly<{
  failureCode: string;
  failureClass: "transient" | "terminal";
  retryable: boolean;
}>;

function assertBoundaryFailure(input: PublishingPlatformBoundaryFailure): void {
  if (
    !/^[A-Z][A-Z0-9_]{0,79}$/.test(input.failureCode) ||
    input.retryable !== (input.failureClass === "transient")
  ) {
    throw new TypeError("Publishing Platform failure classification is invalid.");
  }
}

export class PublishingPlatformPreparationError extends Error
  implements PublishingPlatformBoundaryFailure {
  readonly failureCode: string;
  readonly failureClass: "transient" | "terminal";
  readonly retryable: boolean;

  constructor(input: PublishingPlatformBoundaryFailure) {
    assertBoundaryFailure(input);
    super("Publishing Platform preparation failed.");
    this.name = "PublishingPlatformPreparationError";
    this.failureCode = input.failureCode;
    this.failureClass = input.failureClass;
    this.retryable = input.retryable;
  }
}

export class PublishingPlatformContactReadinessError extends Error
  implements PublishingPlatformBoundaryFailure {
  readonly failureCode: string;
  readonly failureClass: "transient" | "terminal";
  readonly retryable: boolean;

  constructor(input: PublishingPlatformBoundaryFailure) {
    assertBoundaryFailure(input);
    super("Publishing Platform contact readiness failed.");
    this.name = "PublishingPlatformContactReadinessError";
    this.failureCode = input.failureCode;
    this.failureClass = input.failureClass;
    this.retryable = input.retryable;
  }
}

function validCredentialMaterial(
  value: Readonly<Record<string, Readonly<ProviderCredentialMaterial>>>,
): boolean {
  return Object.entries(value).every(([name, credential]) =>
    /^[a-z][a-z0-9_.-]{0,99}$/.test(name) &&
    Boolean(credential) &&
    /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,499}$/.test(credential.profileId) &&
    Number.isInteger(credential.version) && credential.version >= 1 &&
    typeof credential.secret === "string" && credential.secret.length > 0
  );
}

export interface PreparedPublishingPlatformEffect {
  /** Digest of the complete, secret-free external intent. */
  intentDigest: string;
  /** Pins retries and observations to the exact normalized Provider contract. */
  providerContractDigest: string;
  /** Safe relaunch is derived from retained Provider semantics, never a code. */
  launchSafety: ProviderAdapterContract<unknown, unknown>["launchSafety"];
  observation: ProviderAdapterContract<unknown, unknown>["observation"];
  /** Resolves current secret material before the durable contact marker. */
  ensureContactReady(): Promise<void>;
  launch(effectKey: string): Promise<ProviderOutcome<unknown>>;
  observe(
    effectKey: string,
    providerOperationRef: string,
  ): Promise<ProviderOutcome<unknown>>;
}

/**
 * Resolves retained content and credentials at the external-effect boundary.
 * The worker sees only the normalized outcome; plaintext credentials never
 * enter Delivery persistence or events.
 */
export interface PublishingPlatformInvocationBoundary {
  prepare(
    delivery: Readonly<PublishingDeliveryRecord>,
  ): Promise<PreparedPublishingPlatformEffect>;
}

export type PublishingPlatformCredentialResolver = (
  delivery: Readonly<PublishingDeliveryRecord>,
) =>
  | Readonly<Record<string, Readonly<ProviderCredentialMaterial>>>
  | Promise<Readonly<Record<string, Readonly<ProviderCredentialMaterial>>>>;

/**
 * Strict bridge from a retained Delivery snapshot to the shared #159 Adapter
 * contract. Credentials are resolved separately for every external contact and
 * never become part of the canonical intent digest.
 */
export class AdapterPublishingPlatformInvocationBoundary<I, O>
  implements PublishingPlatformInvocationBoundary
{
  constructor(
    private readonly adapter: ProviderAdapter<I, O>,
    private readonly resolveIntent: (
      delivery: Readonly<PublishingDeliveryRecord>,
    ) => I | Promise<I>,
    private readonly resolveCredentials: PublishingPlatformCredentialResolver,
  ) {}

  async prepare(
    delivery: Readonly<PublishingDeliveryRecord>,
  ): Promise<PreparedPublishingPlatformEffect> {
    let unresolvedIntent: I;
    try {
      unresolvedIntent = await this.resolveIntent(delivery);
    } catch (error) {
      if (error instanceof PublishingPlatformPreparationError) throw error;
      throw new PublishingPlatformPreparationError({
        failureCode: "PLATFORM_CONTENT_RESOLUTION_FAILED",
        failureClass: "terminal",
        retryable: false,
      });
    }
    let intent: I;
    try {
      intent = this.adapter.contract.inputSchema.parse(
        structuredClone(unresolvedIntent),
      );
    } catch {
      throw new PublishingPlatformPreparationError({
        failureCode: "PLATFORM_INTENT_INVALID",
        failureClass: "terminal",
        retryable: false,
      });
    }
    const intentDigest = canonicalDigest(intent);
    let credentials:
      | Readonly<Record<string, Readonly<ProviderCredentialMaterial>>>
      | null = null;
    const ensureContactReady = async () => {
      // Resolve once per prepared invocation, immediately before contact. The
      // material remains closure-local and is never retained in Delivery data.
      if (credentials) return;
      try {
        const resolved = await this.resolveCredentials(delivery);
        if (!validCredentialMaterial(resolved)) {
          throw new PublishingPlatformContactReadinessError({
            failureCode: "CREDENTIAL_INVALID",
            failureClass: "terminal",
            retryable: false,
          });
        }
        credentials = resolved;
      } catch (error) {
        if (error instanceof PublishingPlatformContactReadinessError) throw error;
        throw new PublishingPlatformContactReadinessError({
          failureCode: "CREDENTIAL_RESOLUTION_FAILED",
          failureClass: "terminal",
          retryable: false,
        });
      }
    };
    const contactCredentials = () => {
      if (!credentials) {
        throw new TypeError("Publishing Platform credentials were not prepared.");
      }
      return credentials;
    };
    return {
      intentDigest,
      providerContractDigest: canonicalProviderAdapterContractDigest(
        this.adapter.contract,
      ),
      launchSafety: structuredClone(this.adapter.contract.launchSafety),
      observation: this.adapter.contract.observation,
      ensureContactReady,
      launch: async (effectKey) =>
        executeProviderEffect(this.adapter, {
          effectKey,
          intentDigest,
          intent,
          credentials: contactCredentials(),
        }) as Promise<ProviderOutcome<unknown>>,
      observe: async (effectKey, providerOperationRef) =>
        observeProviderEffect(this.adapter, {
          effectKey,
          intentDigest,
          intent,
          credentials: contactCredentials(),
          providerOperationRef,
        }) as Promise<ProviderOutcome<unknown>>,
    };
  }
}

export class PublishingPlatformRegistry {
  private readonly boundaries = new Map<
    string,
    PublishingPlatformInvocationBoundary
  >();

  register(
    platform: string,
    boundary: PublishingPlatformInvocationBoundary,
  ): this {
    if (!/^[a-z][a-z0-9_]{0,99}$/.test(platform)) {
      throw new TypeError("Publishing Platform identity is invalid.");
    }
    if (this.boundaries.has(platform)) {
      throw new TypeError("Publishing Platform is already registered.");
    }
    this.boundaries.set(platform, boundary);
    return this;
  }

  get(platform: string): PublishingPlatformInvocationBoundary | null {
    return this.boundaries.get(platform) ?? null;
  }
}

import { canonicalDigest } from "@/lib/agent-tools/canonical";
import {
  executeProviderEffect,
  observeProviderEffect,
  type ProviderAdapter,
  type ProviderCredentialMaterial,
  type ProviderOutcome,
} from "../runs/provider-adapter";
import type { PublishingDeliveryRecord } from "./types";

export interface PreparedPublishingPlatformEffect {
  /** Digest of the complete, secret-free external intent. */
  intentDigest: string;
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
    const intent = this.adapter.contract.inputSchema.parse(
      structuredClone(await this.resolveIntent(delivery)),
    );
    const intentDigest = canonicalDigest(intent);
    return {
      intentDigest,
      launch: async (effectKey) =>
        executeProviderEffect(this.adapter, {
          effectKey,
          intentDigest,
          intent,
          credentials: await this.resolveCredentials(delivery),
        }) as Promise<ProviderOutcome<unknown>>,
      observe: async (effectKey, providerOperationRef) =>
        observeProviderEffect(this.adapter, {
          effectKey,
          intentDigest,
          intent,
          credentials: await this.resolveCredentials(delivery),
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

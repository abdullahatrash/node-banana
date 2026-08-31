import { canonicalJson } from "@/lib/agent-tools/canonical";
import type { SupportBundleRecord } from "./types";
import type { SupportBundleBindIntent } from "./support-bundles";

export function supportBundleIntentMatchesRecord(input: {
  intent: SupportBundleBindIntent;
  bundle: SupportBundleRecord;
  idempotencyKey: string;
  requestDigest: `sha256:${string}`;
}) {
  const { intent, bundle } = input;
  return intent.state === "pending"
    && intent.workspaceId === bundle.workspaceId
    && intent.idempotencyKey === input.idempotencyKey
    && intent.requestDigest === input.requestDigest
    && canonicalJson(intent.selections) === canonicalJson(bundle.selections)
    && canonicalJson(intent.consent) === canonicalJson(bundle.consent)
    && intent.contentDigest === bundle.contentDigest
    && intent.sizeBytes === bundle.sizeBytes
    && intent.storageKey === bundle.storageKey
    && intent.createdAt.getTime() === bundle.createdAt.getTime()
    && intent.createdAt.getTime() === bundle.storedAt.getTime();
}

import { canonicalDigest } from "@/lib/agent-tools/canonical";

export function credentialEffectRef(input: {
  workspaceId: string;
  effectKey: string;
  stepAttemptId: string;
  attempt: number;
}): string {
  return `credential-effect:v1:${canonicalDigest(input)}`;
}

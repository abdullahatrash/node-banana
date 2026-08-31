import type {
  AgentResourceConstraints,
  AgentResourceKind,
  AgentResourceRef,
} from "./types";

export type AgentResourceConstraintKey =
  keyof AgentResourceConstraints;

type AgentResourceDescriptor = {
  [Kind in AgentResourceKind]: {
    kind: Kind;
    constraintKey: AgentResourceConstraintKey;
    label: string;
  };
};

export const AGENT_RESOURCE_DESCRIPTOR_BY_KIND = {
  channel: {
    kind: "channel",
    constraintKey: "channelIds",
    label: "Channel IDs",
  },
  credential_profile: {
    kind: "credential_profile",
    constraintKey: "credentialProfileIds",
    label: "Credential Profile IDs",
  },
  workflow: {
    kind: "workflow",
    constraintKey: "workflowIds",
    label: "Workflow IDs",
  },
  automation: {
    kind: "automation",
    constraintKey: "automationIds",
    label: "Automation IDs",
  },
  artifact: {
    kind: "artifact",
    constraintKey: "artifactIds",
    label: "Artifact IDs",
  },
} as const satisfies AgentResourceDescriptor;

type DescriptorConstraintKey =
  (typeof AGENT_RESOURCE_DESCRIPTOR_BY_KIND)[AgentResourceKind]["constraintKey"];
type MissingConstraintKey = Exclude<
  AgentResourceConstraintKey,
  DescriptorConstraintKey
>;
const ALL_CONSTRAINT_KEYS_ARE_DESCRIBED: MissingConstraintKey extends never
  ? true
  : never = true;
void ALL_CONSTRAINT_KEYS_ARE_DESCRIBED;

export const AGENT_RESOURCE_DESCRIPTORS = Object.values(
  AGENT_RESOURCE_DESCRIPTOR_BY_KIND,
);

export const AGENT_RESOURCE_KINDS = Object.keys(
  AGENT_RESOURCE_DESCRIPTOR_BY_KIND,
) as AgentResourceKind[];

export function resourceConstraintKey(
  kind: AgentResourceKind,
): AgentResourceConstraintKey {
  return AGENT_RESOURCE_DESCRIPTOR_BY_KIND[kind].constraintKey;
}

export function emptyResourceConstraints(): AgentResourceConstraints {
  return Object.fromEntries(
    AGENT_RESOURCE_DESCRIPTORS.map(({ constraintKey }) => [constraintKey, []]),
  ) as unknown as AgentResourceConstraints;
}

export function intersectResourceConstraints(
  constraints: AgentResourceConstraints[],
): AgentResourceConstraints {
  return Object.fromEntries(
    AGENT_RESOURCE_DESCRIPTORS.map(({ constraintKey }) => {
      const [first = [], ...rest] = constraints.map(
        (entry) => entry[constraintKey] ?? [],
      );
      const intersection = [...new Set(first)]
        .filter((id) => rest.every((values) => values.includes(id)))
        .sort();
      return [constraintKey, intersection];
    }),
  ) as unknown as AgentResourceConstraints;
}

export function resourceConstraintRefs(
  resources: AgentResourceConstraints,
): AgentResourceRef[] {
  return AGENT_RESOURCE_DESCRIPTORS.flatMap(({ kind, constraintKey }) =>
    (resources[constraintKey] ?? []).map((id) => ({ kind, id })),
  );
}

import { describe, expect, it } from "vitest";
import { parseWorkflowCredentialSlots } from "@/types";
import {
  InvalidWorkflowCredentialSlotsError,
  sanitizeWorkflowCredentialSlots,
} from "@/lib/studio/workflow-schema";

const valid = {
  nodeId: "node-1",
  operationIdentity: "openai.responses.create@1",
  slotId: "slot_primary",
};
const openAiNode = {
  id: "node-1",
  type: "llmGenerate",
  data: { provider: "openai" },
};

describe("Workflow Credential Slot schema", () => {
  it("keeps only exact, versioned logical bindings and reconstructs safe fields", () => {
    expect(parseWorkflowCredentialSlots([valid])).toEqual([valid]);
    expect(
      sanitizeWorkflowCredentialSlots({
        nodes: [openAiNode],
        credentialSlots: [valid],
      }),
    ).toEqual({ nodes: [openAiNode], credentialSlots: [valid] });
  });

  it.each([
    [{ ...valid, secret: "must-strip-or-reject" }],
    [{ ...valid, nodeId: "" }],
    [{ ...valid, operationIdentity: "openai.responses.create" }],
    [{ ...valid, operationIdentity: "unknown.responses.create@1" }],
    [valid, { ...valid, slotId: "another_slot" }],
  ])("rejects broad, unversioned, or duplicate bindings", (...slots) => {
    expect(parseWorkflowCredentialSlots(slots)).toEqual([]);
    expect(() =>
      sanitizeWorkflowCredentialSlots({
        nodes: [openAiNode],
        credentialSlots: slots,
      }),
    ).toThrow(InvalidWorkflowCredentialSlotsError);
  });

  it("rejects bindings to missing nodes during load/import", () => {
    expect(() =>
      sanitizeWorkflowCredentialSlots({
        nodes: [],
        credentialSlots: [valid],
      }),
    ).toThrow(InvalidWorkflowCredentialSlotsError);
  });

  it("rejects a provider operation that is incompatible with the bound node", () => {
    expect(() =>
      sanitizeWorkflowCredentialSlots({
        nodes: [
          {
            ...openAiNode,
            data: { selectedModel: { provider: "replicate" } },
          },
        ],
        credentialSlots: [valid],
      }),
    ).toThrow(InvalidWorkflowCredentialSlotsError);
  });

  it("maps Google LLM nodes to Gemini credential operations", () => {
    const binding = {
      nodeId: "node-google",
      operationIdentity: "gemini.generate_content@1",
      slotId: "slot_google",
    };
    expect(
      sanitizeWorkflowCredentialSlots({
        nodes: [
          {
            id: "node-google",
            type: "llmGenerate",
            data: { provider: "google" },
          },
        ],
        credentialSlots: [binding],
      }),
    ).toEqual({
      nodes: [
        {
          id: "node-google",
          type: "llmGenerate",
          data: { provider: "google" },
        },
      ],
      credentialSlots: [binding],
    });
  });
});

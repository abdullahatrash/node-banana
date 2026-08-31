export const PROVIDER_ADAPTER_MANIFEST = Object.freeze([
  Object.freeze({
    module: "conformance/scripted",
    adapterRevision: "scripted-provider-adapter-v1",
    adapterContractDigest:
      "sha256:13e09f1ec1d69c878e654a9291545125c7f0c1c9dea262ed064ab272ddfb29f7",
    workflowOperationIdentity: "conformance.generate_text@1",
    workflowOperationContractDigest:
      "sha256:20de12d434cd174b2020a47718695b826e8bee4593a8f5f42b1b8f38aa925a36",
    provider: "conformance",
    operation: "generate_text.v1",
    model: "golden-v1",
  }),
  Object.freeze({
    module: "gemini/generate-content",
    adapterRevision: "gemini-generate-content-v1",
    adapterContractDigest:
      "sha256:f7e948701df8394da32bbf510e4760588581ece4bfc4475318f360c44cbbdb58",
    workflowOperationIdentity: "gemini.generate_text@1",
    workflowOperationContractDigest:
      "sha256:fb494fb8de2cf72b3d8b97b8cc7bd9fb3e87f7c8dfee72e1861c262339a41dc7",
    provider: "gemini",
    operation: "generativelanguage.v1beta.models.generateContent",
    model: "gemini-2.5-flash",
  }),
  Object.freeze({
    module: "gemini/generate-content",
    adapterRevision: "gemini-generate-content-v1",
    adapterContractDigest:
      "sha256:8e79cea84013b6fddd15d1947316bcd28b6b74618f0831f650e5dfd88d1a90a9",
    workflowOperationIdentity: "gemini.generate_image@1",
    workflowOperationContractDigest:
      "sha256:2e4b7d03dc18b5b94138a634997cc03ab317ec2ff0a2013088bdf0f13843eaa0",
    provider: "gemini",
    operation: "generativelanguage.v1beta.models.generateContent",
    model: "gemini-2.5-flash-image",
  }),
] as const);

export type ProviderAdapterModuleId =
  (typeof PROVIDER_ADAPTER_MANIFEST)[number]["module"];

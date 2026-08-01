export const PROVIDER_ADAPTER_MANIFEST = Object.freeze([
  Object.freeze({
    module: "conformance/scripted",
    workflowOperationIdentity: "conformance.generate_text@1",
    workflowOperationContractDigest:
      "sha256:20de12d434cd174b2020a47718695b826e8bee4593a8f5f42b1b8f38aa925a36",
    provider: "conformance",
    operation: "generate_text.v1",
    model: "golden-v1",
  }),
] as const);

export type ProviderAdapterModuleId =
  (typeof PROVIDER_ADAPTER_MANIFEST)[number]["module"];

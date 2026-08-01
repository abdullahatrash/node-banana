export const PROVIDER_ADAPTER_MANIFEST = Object.freeze([
  Object.freeze({
    module: "conformance/scripted",
    adapterRevision: "scripted-provider-adapter-v1",
    adapterContractDigest:
      "sha256:698e95da513121e2cf1824f744ee07e9c96e2cf9e2201c0e029948bd5be42407",
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
      "sha256:69ba16a8899c938748fb9b0447e9a956ed80c40f98d6d5c143ca6a3fd1b02438",
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
      "sha256:c068360b247276ce8dd74b6057cdef13686003df3e6536d28a2d739415567586",
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

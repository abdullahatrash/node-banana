export interface RuntimePublishingDeliveryInput {
  workspaceId: string;
  deliveryId: string;
  purpose: "publish" | "reconcile";
}

export async function executeRuntimePublishingDelivery(
  input: RuntimePublishingDeliveryInput,
): Promise<{
  deliveryId: string;
  state: string;
  externallyCompleted: boolean | null;
}> {
  "use workflow";

  return executeRuntimePublishingDeliveryStep(input);
}

async function executeRuntimePublishingDeliveryStep(
  input: RuntimePublishingDeliveryInput,
) {
  "use step";

  const { getStepMetadata } = await import("workflow");
  const { publishingDeliveryWorkerId } = await import(
    "@/lib/agent-runtime/publishing-deliveries/worker-identity"
  );
  const { executeProductionPublishingDelivery } = await import(
    "@/lib/agent-runtime/publishing-deliveries/production"
  );
  return executeProductionPublishingDelivery({
    ...input,
    workerId: publishingDeliveryWorkerId(getStepMetadata().stepId),
  });
}

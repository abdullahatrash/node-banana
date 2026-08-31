import { DeliveryOperationsCockpit } from "../DeliveryOperationsCockpit";

export default async function PublishingDeliveryPage({ params }: {
  params: Promise<{ deliveryId: string }>;
}) {
  const { deliveryId } = await params;
  return <DeliveryOperationsCockpit deliveryId={deliveryId} />;
}

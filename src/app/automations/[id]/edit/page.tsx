import { AutomationsScreen } from "../../AutomationsScreen";

export const dynamic = "force-dynamic";

export default async function EditAutomationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AutomationsScreen selectedAutomationId={id} />;
}

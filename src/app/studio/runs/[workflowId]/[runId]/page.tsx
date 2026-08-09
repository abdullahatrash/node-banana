import { RunCockpit } from "./RunCockpit";

export default async function RunPage({ params }: {
  params: Promise<{ workflowId: string; runId: string }>;
}) {
  const { workflowId, runId } = await params;
  return <RunCockpit workflowId={workflowId} runId={runId} />;
}

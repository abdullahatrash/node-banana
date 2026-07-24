"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

interface Workspace {
  id: string;
  name: string;
  role: "owner" | "admin";
}

interface Challenge {
  agentName: string;
  keyName: string;
  requestedAccess: string[];
  expiresAt: string;
}

export default function PairAgentClient({
  confirmationId,
}: {
  confirmationId: string;
}) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/studio/workspaces")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Failed to load Workspaces.");
        setWorkspaces(
          (data.workspaces ?? []).filter(
            (workspace: { role: string }) =>
              workspace.role === "owner" || workspace.role === "admin",
          ),
        );
      })
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : "Failed to load Workspaces."),
      );
  }, []);

  async function inspect(selectedWorkspaceId: string) {
    setChallenge(null);
    setApproved(false);
    if (!selectedWorkspaceId) return;
    const response = await fetch(
      `/api/agents/pairing/${encodeURIComponent(confirmationId)}`,
      { headers: { "x-workspace-id": selectedWorkspaceId } },
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Failed to inspect pairing.");
    setChallenge(data.challenge);
  }

  async function approve() {
    const response = await fetch(
      `/api/agents/pairing/${encodeURIComponent(confirmationId)}`,
      {
        method: "POST",
        headers: { "x-workspace-id": workspaceId },
      },
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Failed to approve pairing.");
    setApproved(true);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Pair Workspace Agent</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose the Workspace deliberately, then review the requested access.
        </p>
      </div>

      <label className="flex flex-col gap-2 text-sm font-medium">
        Workspace
        <select
          aria-label="Workspace"
          className="h-10 rounded-md border bg-background px-3"
          value={workspaceId}
          disabled={approved}
          onChange={(event) => {
            const next = event.target.value;
            setWorkspaceId(next);
            setError(null);
            void inspect(next).catch((cause) =>
              setError(
                cause instanceof Error ? cause.message : "Failed to inspect pairing.",
              ),
            );
          }}
        >
          <option value="">Select a Workspace</option>
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name} ({workspace.role})
            </option>
          ))}
        </select>
      </label>

      {challenge ? (
        <section className="rounded-lg border p-4">
          <h2 className="font-medium">{challenge.agentName}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Initial key: {challenge.keyName} · pairing request expires{" "}
            {new Date(challenge.expiresAt).toLocaleString()}
          </p>
          <h3 className="mt-4 text-sm font-medium">Requested access</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {challenge.requestedAccess.map((access) => (
              <li key={access}>{access}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {approved ? (
        <div className="rounded-md border border-green-500/40 bg-green-500/10 p-4 text-sm">
          Pairing approved. Return to the local agent; it can redeem the
          challenge exactly once.
        </div>
      ) : (
        <Button
          disabled={!workspaceId || !challenge}
          onClick={() => {
            setError(null);
            void approve().catch((cause) =>
              setError(
                cause instanceof Error ? cause.message : "Failed to approve pairing.",
              ),
            );
          }}
        >
          Approve pairing
        </Button>
      )}
    </main>
  );
}

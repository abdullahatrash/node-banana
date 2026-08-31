"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type {
  CredentialAuditEvent,
  CredentialSpendGrant,
  SafeCredentialProfile,
} from "@/types";
import {
  getActiveWorkspaceId,
  invokeCredentialApplicationCapability,
} from "@/lib/studio/client";

export function CredentialCockpit() {
  const [profiles, setProfiles] = useState<SafeCredentialProfile[]>([]);
  const [grants, setGrants] = useState<CredentialSpendGrant[]>([]);
  const [auditEvents, setAuditEvents] = useState<CredentialAuditEvent[]>([]);
  const [error, setError] = useState("");
  const submitKeys = useRef(
    new Map<string, { payload: string; idempotencyKey: string }>(),
  );

  function stableSubmitKey(
    scope: string,
    payload: Record<string, unknown>,
  ): string {
    const serialized = JSON.stringify(payload);
    const current = submitKeys.current.get(scope);
    if (current?.payload === serialized) return current.idempotencyKey;
    const next = crypto.randomUUID();
    submitKeys.current.set(scope, {
      payload: serialized,
      idempotencyKey: next,
    });
    return next;
  }

  async function refresh() {
    if (!getActiveWorkspaceId()) {
      throw new Error("Select a Workspace before managing credentials.");
    }
    const [body, grantBody, auditBody] = await Promise.all([
      invokeCredentialApplicationCapability("credentials.profiles.list@1"),
      invokeCredentialApplicationCapability(
        "credentials.spend_grants.list@1",
      ),
      invokeCredentialApplicationCapability("credentials.audit.list@1"),
    ]);
    const profilesBody = body as {
      profiles?: SafeCredentialProfile[];
    };
    const grantsBody = grantBody as {
      grants?: CredentialSpendGrant[];
    };
    const eventsBody = auditBody as {
      events?: CredentialAuditEvent[];
    };
    setProfiles(profilesBody.profiles ?? []);
    setGrants(grantsBody.grants ?? []);
    setAuditEvents(eventsBody.events ?? []);
  }

  useEffect(() => {
    void refresh().catch((cause) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
    );
  }, []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = event.currentTarget;
    const data = new FormData(form);
    const input = {
      name: data.get("name"),
      provider: data.get("provider"),
      slotName: data.get("slotName"),
      secret: data.get("secret"),
    };
    const scope = "credentials.profiles.create@1";
    try {
      await invokeCredentialApplicationCapability(
        "credentials.profiles.create@1",
        input,
        { idempotencyKey: stableSubmitKey(scope, input) },
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Credential handoff failed.");
      form.reset();
      return;
    }
    submitKeys.current.delete(scope);
    form.reset();
    await refresh();
  }

  async function grantSpend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = event.currentTarget;
    const data = new FormData(form);
    const mode = String(data.get("mode"));
    const limit = String(data.get("limitCents") ?? "").trim();
    const input = {
      principalId: data.get("principalId"),
      profileId: data.get("profileId"),
      mode,
      ...(mode === "bounded" ? { limitCents: Number(limit) } : {}),
    };
    const scope = "credentials.spend_grants.create@1";
    try {
      await invokeCredentialApplicationCapability(
        "credentials.spend_grants.create@1",
        input,
        { idempotencyKey: stableSubmitKey(scope, input) },
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Spend Grant creation failed.");
      return;
    }
    submitKeys.current.delete(scope);
    form.reset();
    await refresh();
  }

  async function revokeGrant(grantId: string) {
    setError("");
    try {
      await invokeCredentialApplicationCapability(
        "credentials.spend_grants.revoke@1",
        { grantId },
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Spend Grant revocation failed.");
      return;
    }
    await refresh();
  }

  async function setStatus(
    profile: SafeCredentialProfile,
    status: "active" | "disabled",
  ) {
    setError("");
    try {
      await invokeCredentialApplicationCapability(
        "credentials.profiles.status.set@1",
        { profileId: profile.id, status },
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Credential status update failed.");
      return;
    }
    await refresh();
  }

  async function rotate(
    event: FormEvent<HTMLFormElement>,
    profile: SafeCredentialProfile,
  ) {
    event.preventDefault();
    setError("");
    const form = event.currentTarget;
    const data = new FormData(form);
    if (profile.activeVersion === null) {
      setError("Reprovision this legacy Credential Profile before rotating it.");
      return;
    }
    const input = {
      profileId: profile.id,
      expectedActiveVersion: profile.activeVersion,
      overlapSeconds: Number(data.get("overlapSeconds") ?? 0),
      secret: data.get("secret"),
    };
    const scope = `credentials.profiles.rotate@1:${profile.id}`;
    try {
      await invokeCredentialApplicationCapability(
        "credentials.profiles.rotate@1",
        input,
        { idempotencyKey: stableSubmitKey(scope, input) },
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Credential rotation failed.");
      form.reset();
      return;
    }
    submitKeys.current.delete(scope);
    form.reset();
    await refresh();
  }

  async function revokeVersion(profile: SafeCredentialProfile) {
    setError("");
    if (profile.activeVersion === null) {
      setError("This legacy Credential Profile has no vaulted version.");
      return;
    }
    try {
      await invokeCredentialApplicationCapability(
        "credentials.versions.revoke@1",
        { profileId: profile.id, version: profile.activeVersion },
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Credential version revocation failed.");
      return;
    }
    await refresh();
  }

  async function reprovision(
    event: FormEvent<HTMLFormElement>,
    profile: SafeCredentialProfile,
  ) {
    event.preventDefault();
    setError("");
    const form = event.currentTarget;
    const data = new FormData(form);
    const input = {
      profileId: profile.id,
      provider: data.get("provider"),
      slotName: data.get("slotName"),
      secret: data.get("secret"),
    };
    const scope = `credentials.profiles.reprovision@1:${profile.id}`;
    try {
      await invokeCredentialApplicationCapability(
        "credentials.profiles.reprovision@1",
        input,
        { idempotencyKey: stableSubmitKey(scope, input) },
      );
      submitKeys.current.delete(scope);
      form.reset();
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Credential reprovision failed.",
      );
    }
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8 text-zinc-100">
      <header>
        <h1 className="text-2xl font-semibold">Credential Profiles</h1>
        <p className="text-sm text-zinc-400">
          Secrets are vaulted during handoff. Agents receive slot IDs and
          redacted metadata only.
        </p>
      </header>
      <form
        className="grid gap-3 rounded-xl border border-zinc-800 bg-zinc-950 p-5 md:grid-cols-2"
        onSubmit={create}
      >
        <input name="name" required placeholder="Profile name" className="rounded bg-zinc-900 p-2" />
        <input name="provider" required placeholder="Provider" className="rounded bg-zinc-900 p-2" />
        <input name="slotName" required placeholder="Logical slot" className="rounded bg-zinc-900 p-2" />
        <input name="secret" type="password" required autoComplete="off" placeholder="Secret handoff" className="rounded bg-zinc-900 p-2" />
        <button className="rounded bg-yellow-400 px-4 py-2 font-medium text-black md:col-span-2">
          Vault Credential Profile
        </button>
      </form>
      <form
        className="grid gap-3 rounded-xl border border-zinc-800 bg-zinc-950 p-5 md:grid-cols-2"
        onSubmit={grantSpend}
      >
        <input name="principalId" required placeholder="Agent Principal ID" className="rounded bg-zinc-900 p-2" />
        <select name="profileId" required className="rounded bg-zinc-900 p-2">
          <option value="">Credential Profile</option>
          {profiles
            .filter(
              (profile) =>
                profile.status === "active" &&
                !profile.reprovisionable &&
                profile.slotId !== null &&
                profile.activeVersion !== null,
            )
            .map((profile) => (
            <option key={profile.id} value={profile.id}>{profile.name}</option>
          ))}
        </select>
        <select name="mode" required className="rounded bg-zinc-900 p-2">
          <option value="bounded">Bounded spend</option>
          <option value="audited_unbounded">Audited unbounded spend</option>
        </select>
        <input name="limitCents" type="number" min="1" placeholder="Bound in cents" className="rounded bg-zinc-900 p-2" />
        <button className="rounded bg-zinc-100 px-4 py-2 font-medium text-black md:col-span-2">
          Create Spend Grant
        </button>
      </form>
      <section className="space-y-2">
        <h2 className="text-lg font-medium">Spend Grants</h2>
        {grants.map((grant) => (
          <article
            key={grant.id}
            className="flex items-center justify-between rounded-xl border border-zinc-800 p-4"
          >
            <p className="text-sm text-zinc-300">
              {grant.principalId} · {grant.mode === "bounded"
                ? `${grant.spentCents}/${grant.limitCents} cents`
                : `${grant.spentCents} cents · audited unbounded`} · {grant.status}
            </p>
            {grant.status === "active" ? (
              <button
                type="button"
                className="rounded border border-red-900 px-3 py-1 text-sm text-red-300"
                onClick={() => void revokeGrant(grant.id)}
              >
                Revoke
              </button>
            ) : null}
          </article>
        ))}
      </section>
      {error ? <p role="alert" className="text-red-400">{error}</p> : null}
      <section className="grid gap-3">
        {profiles.map((profile) => (
          <article key={profile.id} className="rounded-xl border border-zinc-800 p-4">
            <div className="flex items-center justify-between">
              <strong>{profile.name}</strong>
              <span>{profile.secretHint ?? "redacted legacy entry"}</span>
            </div>
            <p className="text-sm text-zinc-400">
              {profile.reprovisionable
                ? `${profile.provider} · legacy profile · reprovision required`
                : `${profile.provider} · slot ${profile.slotName} · v${profile.activeVersion} · ${profile.status}`}
            </p>
            {profile.reprovisionable ? (
              <form
                className="mt-3 grid gap-2 md:grid-cols-3"
                onSubmit={(event) => void reprovision(event, profile)}
              >
                <input
                  name="provider"
                  required
                  defaultValue={profile.provider}
                  aria-label={`Provider for ${profile.name}`}
                  className="rounded bg-zinc-900 p-1 text-sm"
                />
                <input
                  name="slotName"
                  required
                  placeholder="Logical slot"
                  aria-label={`Logical slot for ${profile.name}`}
                  className="rounded bg-zinc-900 p-1 text-sm"
                />
                <input
                  name="secret"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="off"
                  placeholder="Replacement secret"
                  aria-label={`Replacement secret for ${profile.name}`}
                  className="rounded bg-zinc-900 p-1 text-sm"
                />
                <button className="rounded bg-yellow-400 px-3 py-1 text-sm font-medium text-black md:col-span-3">
                  Reprovision legacy profile
                </button>
              </form>
            ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              {(profile.status === "active" ||
                (profile.slotId !== null &&
                  profile.activeVersion !== null &&
                  profile.secretHint !== null &&
                  profile.rotatedAt !== null)) && (
                <button
                  type="button"
                  className="rounded border border-zinc-700 px-3 py-1 text-sm"
                  onClick={() =>
                    void setStatus(
                      profile,
                      profile.status === "active" ? "disabled" : "active",
                    )
                  }
                >
                  {profile.status === "active" ? "Disable" : "Enable"}
                </button>
              )}
              <form
                className="flex gap-2"
                onSubmit={(event) => void rotate(event, profile)}
              >
                <input
                  name="secret"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="off"
                  aria-label={`New secret for ${profile.name}`}
                  placeholder="New secret"
                  className="rounded bg-zinc-900 p-1 text-sm"
                />
                <input
                  name="overlapSeconds"
                  type="number"
                  min="0"
                  max="86400"
                  defaultValue="0"
                  aria-label={`Rotation overlap seconds for ${profile.name}`}
                  className="w-24 rounded bg-zinc-900 p-1 text-sm"
                />
                <button
                  className="rounded border border-zinc-700 px-3 py-1 text-sm"
                >
                  Rotate
                </button>
              </form>
              <button
                type="button"
                className="rounded border border-red-900 px-3 py-1 text-sm text-red-300"
                onClick={() => void revokeVersion(profile)}
              >
                Emergency revoke v{profile.activeVersion}
              </button>
            </div>
            )}
          </article>
        ))}
      </section>
      <section className="space-y-2">
        <h2 className="text-lg font-medium">Unified security audit</h2>
        {auditEvents.map((event) => (
          <article
            key={`${event.source}:${event.id}`}
            className="rounded-xl border border-zinc-800 p-3 text-sm text-zinc-300"
          >
            {event.source} · {event.eventType}
            {event.principalId ? ` · Agent ${event.principalId}` : ""}
            {event.profileId ? ` · Profile ${event.profileId}` : ""}
            {" · "}
            {new Date(event.createdAt).toLocaleString()}
          </article>
        ))}
      </section>
    </main>
  );
}

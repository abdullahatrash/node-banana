# Generation rights evidence erasure

Migrations `0114_generation_rights_evidence_erasure` and
`0115_generation_rights_erasure_preflight` add the only supported
path for permanently deleting immutable inspiration rights evidence and its
embedded snapshots. It is a closure effect, not an application or support
operation.

## Deployment authority

The migration creates two `NOLOGIN` roles:

- `tasmeemai_generation_rights_eraser_owner` owns the `SECURITY DEFINER`
  function and has only the table privileges that function needs.
- `tasmeemai_workspace_closure_worker` can execute the function and has no
  direct table privileges.

Provision a dedicated closure-worker database login outside application
deployments and grant only `tasmeemai_workspace_closure_worker` to it. Never grant that role to the web application, migration runner, support tooling, or
an interactive user. The worker must use a separate connection pool and must
not expose its connection URL or the HMAC key to the application process.

Before any content/model surface containing rights copies is touched, the
external worker handles
`/v1/workspaces/hard-erase/generation-rights-preflight` by opening a short
transaction, setting the isolated role and HMAC settings, and calling
`preflight_closed_workspace_generation_rights`. Only an `eligible` signed
result permits a rights-bearing dependent deletion. A rights hold returns its
exact database-derived hold IDs and a signed hold-and-policy decision: those
rights-dependent surfaces and their assets remain retained while unrelated
surfaces may still be erased. Floors, malformed policy, receipts, export,
access, or lease failures stop the sequence before its first destructive
request.

Issuing an eligible preflight is the irreversible legal cutover. A database
trigger serializes retention policy/hold writes on the same Workspace lock and
rejects them after cutover until the rights tombstone exists. The cutover does
not expire with a worker lease: a reclaimed worker creates a new lease-bound
signed preflight against the unchanged rights set and policy. This prevents a
hold or policy mutation from appearing after a dependent copy was erased but
before the canonical rights rows are erased.

The external `/v1/workspaces/hard-erase` handler receives the exact
`closureLease` and signed preflight in the `workspace-closure-hard-erasure/v3`
request. Each rights-bearing dependent handler re-runs the DB preflight inside
the same transaction as its deletion and returns the exact preflight digest.
For the `inspiration_rights_evidence_and_snapshots` surface it opens one short
transaction on the dedicated connection, selects the executor role, sets
`app.generation_rights_erasure_hmac_key` and
`app.generation_rights_erasure_hmac_key_id` with `SET LOCAL`, and calls:

```sql
SELECT *
FROM public.erase_closed_workspace_generation_rights_v2(
  $1::text,
  $2::text,
  $3::text,
  $4::integer,
  $5::text
);
```

The values are Workspace ID, closure ID, lease ID, lease fence, and exact
preflight digest. The
HMAC key must be at least 32 bytes and must come from the closure worker's
secret manager. It is never a function argument or a stored database value.

The handler may emit `state: deleted` only for the strict
`generation-rights-erasure-result/v2` SQL result with `outcome` equal to
`erased` or `replayed`, the exact tombstone digest/counts/time/signing-key ID,
audit event binding, and matching preflight digest. Generic `deleted` or
`not_found` responses are rejected. Treat `erased` and a same-closure
`replayed` result as success. Every `blocked_*`
result is a durable, signed, non-success attempt and must be retried only through
the normal fenced closure workflow. Identity, authority, fence, and unexpected
database failures raise; never translate either a block or exception into
`deleted`.

Keep historical HMAC keys available to this isolated worker for replay
verification. Before a replay, the worker obtains the non-sensitive key ID
without receiving table access:

```sql
SELECT public.generation_rights_erasure_signing_key_id_v2(
  $1::text,
  $2::text,
  $3::text,
  $4::integer,
  $5::text
);
```

The arguments are Workspace ID, closure ID, lease ID, lease fence, and the
blocked outcome code (an empty string for a successful tombstone). The worker selects
that key from its isolated keyring and then invokes the eraser. An unknown key,
mismatched key ID, invalid MAC, or missing audit/receipt binding fails closed.
Rotation must not rewrite tombstones.

The closure body retains a monotonically increasing `leaseFence` high-water
mark even when the active lease is released. Every claim increments it. Blocked
attempt identity binds both this fence and the random lease ID, so retries from
different lease epochs cannot replay or overwrite one another.

`blocked_retention_period` also returns the exact `eligibleAt` recorded in its
signed attempt. The closure persists that timestamp and both direct claims and
the sweeper skip it until the time arrives, avoiding repeated leases, audit
events, and signed attempts throughout a long legal floor. Policy and hold
changes may still wake/restart the workflow explicitly; malformed or unbounded
holds never receive a guessed automatic expiry.

A successful v2 erasure atomically stores a keyed, append-only binding between
the issued preflight and the rights tombstone. If the HTTP response is lost,
the current fenced lease can recover the historical key ID, verify the original
preflight, replay the base tombstone proof, and return the same v2 result without
trying to reconstruct the already-erased rights set. A later reclaimed lease
follows the same path but must itself still be current and unexpired.
For deployments upgrading from 0114, a valid tombstone created before 0115 is
adopted only by replaying and verifying its original HMAC, receipt, and audit
proof. The v2 preflight copies the proven historical counts and commitments;
it never substitutes a post-erasure empty set.

## Fail-closed prerequisites

The database derives every prerequisite itself while holding the same
Workspace governance advisory lock used by governance mutations. It requires:

- the exact unexpired `erasure_running` closure lease and completed retention
  enumeration;
- proven access revocation, a successful closure export, and terminal closure
  deletion receipts;
- one active `generation_rights_evidence` rule with the deployment-trusted
  365-day legal floor;
- no active, unexpired hold for that retention class, no malformed active hold,
  and no hold lacking an exact v2 scope review against the active policy;
- expiration of the greatest configured duration, recovery period, and legal
  floor for every rights row;
- prior erasure of every generation intent, because intent JSON embeds the
  complete rights evidence; and
- no rights evidence, snapshot, or embedded/null-FK generation-intent write
  racing the operation.

New `retention.manage@1` commands publish `retention-policy-revision/v2`.
Legacy eight-rule clients remain compatible: the service adds a conservative
`generation_rights_evidence` rule derived from consent evidence and never below
365 days. Stored pre-v2 policies must still be superseded before closure. A
active hold without `retention-hold-scope-review/v2` must be reviewed, released,
or explicitly reissued against the current v2 policy so a stale client's
omission of the new class cannot silently permit erasure.
The existing `create_retention_hold` (`retention.manage@1`) command therefore
adds `generation_rights_evidence` to every new hold. It never fabricates a
`not_applicable` review from omission; that decision requires a future explicit,
policy-version-bound command contract.
Retention and recovery windows are capped at 36,500 days (100 years), so
malformed or overflow-sized policy values durably block rather than reaching
timestamp arithmetic.

## Closure surface order

The closure adapter erases direct content/model dependents, then rights rows,
then all other asset-referencing content/brand/social surfaces, then assets,
then governance/membership surfaces, and finally Workspace identity. Governance
and identity responses must prove preservation of the active closure, the
rights proof, and eventual closure completion proof. Workspace identity uses
canonical close redaction/soft deletion; it must not physically remove the row
that the worker's final `workspace_close` transaction still needs.
When rights are retained, direct rights-bearing dependents, the rights surface,
and their assets remain held; independent non-finalization surfaces may still
be erased. Governance, memberships, and Workspace identity finalization are
deferred, so the closure remains write-blocked in `waiting_erasure` rather than
stranding rights evidence in terminal `closed_retained`. If every blocking hold
has a finite canonical expiry, the signed attempt returns their latest expiry
and the worker schedules exactly one revalidation at that time. An indefinite
or malformed hold creates no polling deadline and therefore no audit churn;
an explicit worker revalidation or an atomic `release_retention_hold` mutation
wakes the affected closure. The wait marker itself is committed only while the
repository holds the Workspace governance lock and revalidates the exact signed
policy/hold decision. A release racing between preflight and that commit causes
a conflict and an immediate unmarked retry, so its wakeup cannot be lost. After
holds clear, the normal fenced preflight and ordered erasure resume. Ordinary
non-rights retained resources can still reach `closed_retained`; the special
wait applies only to generation-rights evidence.

## Surviving proof

The function atomically deletes evidence and snapshots and writes one
append-only tombstone, one idempotency receipt, and one redacted Workspace audit event. The tombstone
contains counts, a keyed aggregate manifest commitment, policy and audit bindings,
and an HMAC. It does not retain a public/linkable manifest hash, rights JSON, source/evidence/asset/issuer/user
identifiers, URLs, or per-row commitments. A same-closure retry returns the
original result only after re-verifying the tombstone MAC and exact audit and
receipt bindings; a different closure ID fails.
The v2 boundary additionally preserves a keyed preflight-to-tombstone binding;
neither that binding nor the preflight contains raw rights evidence or public
per-record fingerprints.
Blocked rights retention additionally preserves an append-only
`generation_rights_retention_decisions` row whose HMAC binds the exact hold IDs,
policy revision snapshot digest, lease, and signed attempt digest.

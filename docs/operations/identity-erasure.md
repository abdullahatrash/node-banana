# Identity erasure operations

Node Banana erases an individual identity without cascading deletion through
Workspace, rights, audit, or financial records that have an independent
retention lifecycle. The operation removes authentication and access state,
scrubs direct personal data, and leaves a pseudonymous user tombstone so
retained records keep valid foreign-key and evidentiary bindings.

## User flow

The Account settings surface first calls `GET /api/account/erasure`. The
preflight reports every non-deleted Workspace the user owns and blocks erasure
until each one has a terminal `workspace_closure` resource with status `closed`
or `closed_retained`. Memberships in Workspaces owned by someone else do not
block; they are removed by erasure.

`POST /api/account/erasure` requires:

- a real authenticated session and a matching `Origin` header;
- the exact confirmation command `ERASE` plus all three irreversible-action
  acknowledgements;
- current-password verification for credential identities; or
- an OAuth-only session created no more than 15 minutes ago.

Development authentication bypass is intentionally not accepted by this
destructive endpoint.

## Atomic effect

One transaction takes an identity-scoped advisory lock and locks the user row.
It then rechecks Workspace ownership before:

- deleting Better Auth accounts and sessions;
- deleting Better Auth organization membership and canonical Workspace
  membership;
- deleting interface, onboarding, notification, and read-state preferences;
- deleting pending identity invitations and verification records;
- nulling the user and session links on retained onboarding analytics;
- cancelling and scrubbing advertising-attribution events and appending a
  revoked consent revision;
- cancelling queued membership projections, revoking active role assignments,
  and tombstoning matching governance invitation email addresses; and
- replacing the user name, email, image, and verification state with a unique
  non-deliverable tombstone identity.

The transaction finishes by writing one bounded receipt containing only a
random receipt ID, request digest, aggregate counts, and timestamps. A database
trigger rejects receipt updates. Deletion remains available to an explicitly
authorized retention or test-cleanup process; ordinary application code has no
receipt deletion path.

## Anti-resurrection guards

Database triggers on `account`, `session`, `member`, and `workspace_members`
lock the referenced user row and reject inserts or user reassignment when an
identity-erasure receipt exists. Using the same user-row lock as erasure closes
both race orders:

- access state committed first is seen and removed by erasure;
- access state attempted after erasure begins waits, then sees the committed
  receipt and fails.

Do not disable these triggers in an authentication, invitation, membership, or
projection worker.

## Local verification

Apply migrations and run the focused contracts:

```bash
pnpm db:migrate
pnpm exec vitest run \
  src/lib/auth/__tests__/identity-erasure-contract.test.ts \
  src/lib/auth/__tests__/identity-erasure-migration.test.ts \
  src/app/api/account/erasure/route.test.ts \
  src/components/product-shell/__tests__/AccountSettings.test.tsx
```

The real PostgreSQL test creates and removes a disposable identity and
Workspace. It also proves that authentication, session, membership, and receipt
rewrites are rejected after erasure:

```bash
RUN_POSTGRES_INTEGRATION=true \
  node --env-file=.env.local node_modules/vitest/vitest.mjs run \
  src/lib/auth/__tests__/identity-erasure-postgres.integration.test.ts
```

For a manual UI smoke, use a disposable user. Close or transfer every owned
Workspace, open Settings → Account → Security, export any data the tester needs,
complete every acknowledgement, type `ERASE`, and reauthenticate. Success must
end at `/sign-in?erased=1`; the deleted credentials must no longer sign in.

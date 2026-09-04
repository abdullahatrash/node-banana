# Local real-backend validation

This runbook tests Node Banana through its real local Postgres, object storage,
authentication, Workspace authorization, workers, and provider admission
boundaries. It separates no-spend validation from the few steps that can call a
third party or debit Generation Credits.

## 1. Start one consistent local origin

Use one port for the app and every auth URL. The simplest port-3002 setup leaves
`BETTER_AUTH_URL`, `NEXT_PUBLIC_BETTER_AUTH_URL`, and `NEXT_PUBLIC_APP_URL`
unset. If any is set, all three must be `http://localhost:3002`.

```bash
pnpm infra:up
pnpm db:migrate
pnpm db:seed
PORT=3002 pnpm dev
```

Do not start a second dev process when `.next/dev/lock` exists. Reuse or stop
the process already listening on port 3002 instead of deleting the lock while
that process is alive.

The seeded Owner is `alice@nodebanana.dev` with password `Password123!`, and
the seeded Workspace is `seed_ws_alice`. These credentials are local fixtures
only.

## 2. Establish the no-spend baseline

Run these from another terminal while the app is running:

```bash
pnpm doctor:local -- --workspace seed_ws_alice
APP_BASE_URL=http://localhost:3002 pnpm smoke:infra
APP_BASE_URL=http://localhost:3002 pnpm smoke:i18n-shell
APP_BASE_URL=http://localhost:3002 pnpm smoke:product
pnpm smoke:licensed-trends
pnpm test:run
pnpm typecheck
pnpm i18n:check
```

The readiness doctor is the authority for what is executable. A green database,
storage, Brand, billing catalog, and credit balance does not make AI execution
ready by itself. BYOK generation also needs a validated Workspace Replicate
credential, a signed model qualification, and verified provider-processing
region evidence. Managed generation needs those model and region gates plus the
server-owned managed token and stable key revision.

## 3. Validate feature by feature

| Capability | Where to test | Real dependency | Acceptance boundary | Spend |
| --- | --- | --- | --- | --- |
| Authentication and Workspace switching | `/sign-in`, then `/dashboard` | Better Auth and Postgres | Alice signs in, only authorized Workspaces appear, refresh preserves the active Workspace, and sign-out removes the session. | None |
| Arabic and English shell | Language switcher, then all primary routes | Stored user preference and authored catalogs | Arabic produces `lang=ar`, `dir=rtl`, logical right-side navigation and correct mixed-direction text; English restores LTR. `smoke:i18n-shell` covers the route matrix. | None |
| Public pricing | `/ar/pricing` and `/en/pricing` | Active versioned billing catalog | Plans and authored prices render in both languages without authentication. | None |
| Balance, plans, and packs | Header credit control and `/billing` | Subscription, credit buckets and ledger | Header and billing page agree on available credits; plan/pack actions clearly report merchant availability. | None until checkout is explicitly opened |
| Brand memory | `/brand` | Accepted immutable Brand Profile | The active revision contains audience, voice, visual and Arabic-language direction; generation remains closed without an accepted revision. | None |
| Provider credentials | `/settings?section=providers` | `BYOK_KEY_ENCRYPTION_KEY`, step-up delivery, Workspace vault | Saving a Replicate token requires fresh verification, validates the account without a prediction, stores ciphertext only, and never returns the token. | No generation spend |
| Workspace media | `/library` and upload controls | MinIO/S3-compatible storage and Postgres | Presign, upload, finalize, preview, list and soft-delete preserve Workspace isolation and storage quota. | None |
| AI model catalog | Image/video/copy model selector | Signed qualification envelope and trust key | Only unexpired, capability-matching, region-admitted Replicate models are selectable; model/version/schema and unit price are pinned. | None |
| Generation admission | `/simple-studio/images`, `/simple-studio/videos`, `/simple-studio/copy` | Brand, rights, model, budget, region and selected funding mode | The panel explains BYOK versus managed billing and shows a provider-cost estimate. Managed mode requires an exact expiring credit quote before dispatch. | None until the user confirms a managed quote or submits with BYOK |
| Workspace winning-content trends | `/inspiration` | Published Workspace post, rights snapshot and performance worker | Verified or attested metrics produce a provenance-labelled Inspiration Item without scraping third-party media. Follow `workspace-winning-content.md`. | None |
| YouTube public trends | `/inspiration` | YouTube Data API key and reviewed policy URLs | Only metadata and source links are stored; public YouTube media is never treated as remixable. Follow `youtube-trend-discovery.md`. | Google API quota only; no Generation Credits |
| Licensed trend media | `/inspiration` | Versioned licensed package, entitlement and storage worker | Preview/import is available only to the entitled Workspace; rights and object digests remain pinned. `smoke:licensed-trends` exercises the entire local path. | None |
| Brand-aware remix | `/blitz` | Remixable Inspiration Item and admitted video model | The user sees preserved influences, Brand direction and protected-expression exclusions; acceptance generates a new 9:16 Asset and must pass similarity gates before promotion. | Provider/credit spend only after generation confirmation |
| Content formats | `/content` | Format definitions, Brand resources and admitted model when generation is used | Draft/save/revision behavior works; generated media pins its source Assets, format, Brand, rights and model receipts. | Only generation actions |
| Social compose and calendar | `/compose`, `/calendar`, `/channels` | Workspace assets and a real supported channel connection | Draft, approval, scheduling and delivery state are durable. Publishing is external and must be tested on a dedicated test account. | Platform side effect, no Generation Credits |
| Workers and recovery | `pnpm workers:local -- --url http://localhost:3002` | `STUDIO_INTERNAL_API_SECRET` and Postgres | Leases, retries and idempotency converge without duplicate Assets, posts, ledger entries or Inspiration Items. | A worker never invents authority to start a new generation |
| Governance and erasure | `/settings` governance/privacy/account sections | Postgres, object storage and configured external adapters | Export, retention, legal hold, closure and erasure show exact scope, require the correct confirmations, and retain only the allowed audit evidence. | None; external deletion adapters may have side effects |

## 4. Open real Replicate execution deliberately

`BYOK_KEY_ENCRYPTION_KEY` is only the vault-encryption master key. Choose one
funding lane:

1. **BYOK:** save the real Replicate token in Provider credentials after the
   step-up challenge. Replicate bills that Workspace's provider account.
2. **Managed:** set `REPLICATE_MANAGED_API_TOKEN`,
   `REPLICATE_MANAGED_KEY_REVISION`, and the managed USD-to-credit rate on the
   server. Node Banana reserves and debits Workspace Generation Credits.

Both lanes stay closed until the operator completes
`model-qualification-operations.md` and `provider-region-evidence.md`.
Qualification is the sole operator path that intentionally makes paid smoke
predictions, is capped below USD 0.40 for the reviewed matrix, and requires the
literal `--execute-paid-smoke` flag. Never use a customer Workspace key for
qualification.

Start with the least expensive admitted path: one 9:16 image or one short draft
video, one output, BYOK, and no retry. Confirm the resulting Generation Intent,
Operation, Asset, provider receipt, and cost settlement before increasing batch
count or duration.

`smoke:product` never crosses that boundary. Its generation request deliberately
names an unqualified sentinel model and must receive `MODEL_NOT_EXECUTABLE`
before provider dispatch; the command also verifies that the Workspace credit
balance is unchanged. It is safe to run repeatedly and cannot be repurposed for
a real model because the sentinel reference is embedded in the script.

## 5. Interpret the Fastlane-style trend loop correctly

The product has three explicit acquisition lanes rather than one opaque
"trending" bucket:

1. Workspace-owned published performance can become remixable because its
   Asset and rights are known.
2. YouTube `mostPopular` discovery supplies current metadata and attribution,
   but remains reference-only without independent rights.
3. Licensed catalog packages supply media only when a commercial agreement,
   immutable source/evidence objects, and a Workspace entitlement allow the
   requested transformation.

Every lane can inform a Brand-aware Remix Brief. Only a lane with verified
media rights can supply source media to generation. The accepted Brand Profile
then contributes voice, audience, visual language, Arabic variety and protected
elements; the remix keeps abstract influences such as hook, pacing or structure
while excluding the source creator's protected expression.

## Related runbooks

- [Workspace winning-content trends](workspace-winning-content.md)
- [YouTube trend discovery](youtube-trend-discovery.md)
- [Licensed trend catalog](licensed-trend-catalog.md)
- [Replicate model qualification](../model-qualification-operations.md)
- [Provider processing-region evidence](provider-region-evidence.md)
- [Generation rights and erasure](generation-rights-erasure.md)

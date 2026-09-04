# Workspace winning-content trends

The production trend adapter learns from a Workspace's own published,
rights-cleared videos. It does not download third-party media, scrape social
sites, or treat unverified public popularity as permission to remix.

## Local setup

Start the real local dependencies, apply migrations, and run the app on the
same origin configured by the auth environment:

```bash
pnpm infra:up
pnpm db:migrate
pnpm db:backfill:org
PORT=3002 pnpm dev
```

Keep `BETTER_AUTH_URL`, `NEXT_PUBLIC_BETTER_AUTH_URL`, and
`NEXT_PUBLIC_APP_URL` unset for same-origin local development, or set all of
them to `http://localhost:3002`. Mixing port 3000 and 3002 causes auth
redirects and cookies to target the wrong process.

Before spending generation credits, check the seeded Workspace:

```bash
pnpm doctor:local -- --workspace seed_ws_alice
```

## Feature-by-feature test

1. Sign in and choose the seeded Workspace.
2. Upload or generate a video and wait until the Workspace asset is `ready`.
3. Admit owned-rights evidence for that exact asset. The resulting Rights
   Snapshot must permit at least reference use.
4. Publish the video through a connected social channel. The post must have a
   real HTTPS platform URL and a stable media reference whose digest matches
   the Workspace asset.
5. Open `/inspiration`, expand **Workspace performance**, and choose one path:
   - **Verified analytics sync** fetches exact metrics for the published post
     from its connected Instagram, TikTok, or YouTube account. Select the
     market, language, Arabic variety when applicable, format, tags, and sync
     interval. No metric counts or provider token are accepted from the form.
   - **Manual analytics attestation** records counts from a provider export or
     an unsupported platform, together with the export/source reference.
6. Run the performance worker, then the trend worker. Refresh the page.
7. Confirm the card shows the Workspace analytics source, unknown provider
   fields as an em dash (never a fabricated zero), localized reason labels,
   and either **Platform verified** or **Workspace attested** provenance.
8. Open the source link and verify it resolves to the published post. Stored
   evidence pins its source digest and the exact Rights Snapshot without
   persisting any access or refresh token.
9. Add the Inspiration Item to Blitz. The server must create a
   `brand-aware-remix-brief/v1` snapshot that pins the accepted Brand Profile
   revision, Inspiration revision, rights digest, content language, Arabic
   variety, permitted topic/hook/pacing/structure directions, original Brand
   direction, protected-expression exclusions, and exact provider contract.
10. In `/blitz`, verify the Brand angle and audience are visible before any
    generation begins. An older generic proposal is deliberately disabled and
    must be re-queued so it cannot spend against stale Brand or rights state.
11. Select a qualified Replicate video model. In managed mode, confirm the
    exact expiring Generation Credit quote. In BYOK mode, confirm the
    Workspace has a durable Replicate credential. Admission must reject any
    changed prompt, source Asset, evidence list, language, Arabic variety,
    capability, Brand revision, or stale Blitz revision before dispatch.
12. Accept only after the generated 9:16 Asset passes text, frame, and audio
    similarity checks. Promotion to a Content Piece rechecks the exact Rights
    Snapshot and Remix Brief digest from the Generation Intent; it does not
    schedule or publish the result.

## Running the worker locally

Both internal endpoints are intended for a scheduler. Invoke them with the
same `STUDIO_INTERNAL_API_SECRET` configured in `.env.local`:

```bash
pnpm workers:local -- --url http://localhost:3002
```

The command loads `.env.local` using Next.js semantics and never prints the
secret. The equivalent individual requests are:

```bash
curl --fail --silent --show-error \
  -H "x-studio-internal-secret: $STUDIO_INTERNAL_API_SECRET" \
  "http://localhost:3002/api/studio/internal/social-performance-sync?limit=20"

curl --fail --silent --show-error \
  -H "x-studio-internal-secret: $STUDIO_INTERNAL_API_SECRET" \
  "http://localhost:3002/api/studio/internal/inspiration-trends?limit=20"
```

The performance worker schedules due syncs, recovers expired leases, refreshes
OAuth tokens when possible, retries transient failures with bounded backoff,
and marks accounts that need reconnection. Provider calls happen outside
database transactions. The trend adapter uses keyset pagination, processes
only the latest observation for each published post as of the job's request
time, and revalidates the exact asset and rights evidence before a candidate
can enter the discovery feed.

## Trust boundary

Provider-verified counts are available only for exact posts owned by the
connected Instagram, TikTok, or YouTube account. They remain distinct from
manual Workspace attestations throughout storage and UI. This does not scrape
or download platform-wide trending videos. Adding a public or licensed trend
source remains fail-closed until its source contract, permitted reuse,
attribution, deletion/refresh window, and derived-metrics policy are approved.

Social OAuth tokens use `SOCIAL_TOKEN_ENCRYPTION_KEY`. Workspace AI provider
keys such as Replicate use the separate `BYOK_KEY_ENCRYPTION_KEY`; neither key
is the Replicate API token itself. Public plan pricing is available at
`/en/pricing` and `/ar/pricing`. Authenticated balances, plan actions, and
credit packs are under `/settings?section=billing`.

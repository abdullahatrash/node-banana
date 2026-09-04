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
5. Open `/inspiration`, expand **Record winning content**, choose the published
   post, and record the observed views, likes, comments, region, language,
   Arabic variety when applicable, format, tags, and the source of the metrics.
6. The submission creates an append-only Workspace attestation and queues a
   trend refresh. Refresh the page after the worker completes.
7. Confirm the resulting card shows the `Workspace analytics` source, the
   observed counts, localized reason labels, and whether it is eligible for
   Blitz.
8. Open the source link and verify it resolves to the published post. The
   stored trend evidence also pins the attestation reference/digest and the
   exact Rights Snapshot.

## Running the worker locally

The app's internal trend endpoint is intended for a scheduler. Invoke it with
the same `STUDIO_INTERNAL_API_SECRET` configured in `.env.local`:

```bash
curl --fail --silent --show-error \
  -H "x-studio-internal-secret: $STUDIO_INTERNAL_API_SECRET" \
  "http://localhost:3002/api/studio/internal/inspiration-trends?limit=20"
```

The adapter uses keyset pagination, processes only the latest observation for
each published post as of the job's request time, and revalidates the exact
asset and rights evidence before a candidate can enter the discovery feed.

## Trust boundary

Performance counts are explicitly Workspace-attested. They are useful for
ranking a brand's own winners, but they are not represented as platform-
verified analytics. Adding a YouTube or other third-party trend adapter remains
fail-closed until the source contract, attribution UI, deletion/refresh window,
and derived-metrics policy are approved.

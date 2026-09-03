# X (Twitter) Live End-to-End Verification Runbook

Proves the full publishing pipeline against the real X API: connect → compose →
schedule → durable dispatch → published → status reconciled. First executed
successfully on 2026-07-10 (see Evidence).

## Prerequisites

- X developer app with **OAuth 1.0a** enabled, app permissions **Read and
  write**, and callback URL `<origin>/api/social/accounts/callback` registered.
- `X_API_KEY` / `X_API_SECRET` in the environment — these are the **Consumer
  Keys ("API Key and Secret")** from the app's *Keys and tokens* tab, **not**
  the OAuth 2.0 Client ID/Secret. Error code 32 ("Could not authenticate you")
  on connect means the wrong pair was used.
- Running app with `DATABASE_URL`, `BETTER_AUTH_SECRET`,
  `SOCIAL_TOKEN_ENCRYPTION_KEY`, `SOCIAL_INTERNAL_API_SECRET` set.
- Credential sanity check without touching the app (expects an auth URL, not
  an error):

  ```bash
  node --input-type=module -e "
  import { TwitterApi } from 'twitter-api-v2';
  const c = new TwitterApi({ appKey: process.env.X_API_KEY, appSecret: process.env.X_API_SECRET });
  console.log((await c.generateAuthLink('http://localhost:3000/api/social/accounts/callback', { linkMode: 'authorize' })).url);
  "
  ```

## Steps and expected observables

| # | Step | Expected observable |
|---|------|---------------------|
| 1 | Sign in, select a workspace | Social Hub loads; `GET /api/social/accounts` is 200 (a 403 usually means a stale `node-banana-active-workspace-id` in localStorage) |
| 2 | Channels → Connect X | Redirect to `api.x.com/oauth/authorize`; after approval, account appears connected |
| 3 | Verify storage | `social_accounts` row: `platform=x`, `requires_reauth=false`, `access_token_encrypted` is ciphertext (never plaintext) |
| 4 | Compose → schedule 2–3 min out | `social_posts` row: `status=publishing`, `dispatch_status=dispatched` — the durable workflow claims the post immediately and sleeps until `scheduled_at` |
| 5 | Wait for the scheduled time | `status=published`, `platform_post_url` set, `published_at` within seconds of `scheduled_at` |
| 6 | Open `platform_post_url` | The post is live on X |

In production the Vercel crons (`docs/social-cron-scheduler.md`) provide the
safety net for step 4/5: `dispatch` picks up queued posts and
`recover-missing-dispatch` re-claims stranded ones. To exercise those paths
manually:

```bash
curl -H "Authorization: Bearer $SOCIAL_INTERNAL_API_SECRET" <origin>/api/social/internal/dispatch
curl -H "Authorization: Bearer $SOCIAL_INTERNAL_API_SECRET" <origin>/api/social/internal/recover-missing-dispatch
```

## Evidence (2026-07-10, local run against live X)

- Connected account: `@abodiatrash` (tokens stored AES-256-GCM encrypted).
- Post `spost_020d4d0f-251b-4bb4-b4fc-81efd022cdd2`: scheduled 08:03:00 UTC,
  published 08:03:04 UTC.
- Live URL: <https://x.com/abodiatrash/status/2075490972503334981>
- Defects found during the run (both already tracked): wrong-key-pair connect
  failures surface as an opaque 500 (should surface X's error), and a stale
  active-workspace id dead-ends all social routes in 403s.

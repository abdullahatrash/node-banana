# YouTube trend discovery operations

Node Banana exposes YouTube's public `mostPopular` chart as a separate, metadata-only discovery lane. It does not feed the Brand-fit ranking, Workspace Product Record history, Remix, or Blitz. No YouTube video or audio is downloaded, copied to object storage, or sent to a generation provider.

## Why it is separate

The default YouTube API policies prohibit using API Data to create a score based on views, likes, or other YouTube metrics and require non-authorized public API Data to be refreshed or deleted within 30 days. The normal Inspiration ingestion path creates cross-source Brand scores and immutable history, so YouTube data has its own mutable and purgeable tables.

The lane preserves the provider's returned order. The UI says that YouTube combines multiple signals and does not describe the chart as “highest views.” Missing counters remain unknown, and unsigned-long counters remain decimal strings in storage so JavaScript cannot silently round them.

## Production gate

Configure all four values before the UI permits a chart source:

```dotenv
YOUTUBE_TREND_DISCOVERY_ENABLED=true
YOUTUBE_DATA_API_KEY=server-side-google-api-key
NEXT_PUBLIC_TERMS_URL=https://example.com/terms
NEXT_PUBLIC_PRIVACY_URL=https://example.com/privacy
```

The API key is a Google/YouTube provider credential, not `BYOK_KEY_ENCRYPTION_KEY`. Keep it server-side and restrict it in Google Cloud to the YouTube Data API and the deployment's server egress where possible. The Terms URL must state that users of the YouTube feature agree to the YouTube Terms of Service. The Privacy URL must disclose use of YouTube API Services, data access/storage/use/sharing, and link to Google's Privacy Policy. Obtain legal review before production launch.

Setting `YOUTUBE_TREND_DISCOVERY_ENABLED=false` is the operator erasure switch. The next YouTube worker run deletes every cached discovery entry across Workspaces and performs no provider call. Removing one chart in the UI immediately cascades deletion of that chart's cached entries and jobs.

## Quota and credits

Each configured chart run makes exactly one `videos.list` request and asks for at most 50 results. Google documents this call as one YouTube Data API quota unit. The UI shows the conservative daily estimate:

- Hourly: 24 units/day per chart.
- Every 6 hours: 4 units/day per chart.
- Every 12 hours: 2 units/day per chart.
- Daily: 1 unit/day per chart.

Viewing or refreshing this lane spends no Node Banana Generation Credits and does not call Replicate, Gemini, OpenAI, Kie, fal.ai, or WaveSpeed. YouTube quota is a separate Google Cloud allowance. Invalid requests can still consume provider quota, so the adapter validates region, category, interval, and result count before making a request; permanent credential/configuration failures pause the source; quota failures defer it for 24 hours; only transient network, 408, 429, and 5xx failures retry automatically.

Pricing remains available publicly at `/en/pricing` and `/ar/pricing`. The authenticated balance and plan controls are at `/settings?section=billing`.

## Local end-to-end test

1. Apply the schema:

   ```bash
   pnpm db:migrate
   ```

2. Add the four production-gate values to `.env.local`. For local disclosure testing, the Terms and Privacy values may point to loopback pages; production requires public HTTPS policies that contain the required disclosures.

3. Start the app on the desired port. All auth URLs must use that same port:

   ```bash
   NEXT_PUBLIC_APP_URL=http://localhost:3002 BETTER_AUTH_URL=http://localhost:3002 NEXT_PUBLIC_BETTER_AUTH_URL=http://localhost:3002 pnpm dev --port 3002
   ```

4. Open `/inspiration`, add one MENA chart, and keep the default six-hour interval and 25 results for a low-cost smoke.

5. Run all local content workers once:

   ```bash
   pnpm workers:local -- --url http://localhost:3002
   ```

   The `youtube-trends` line reports whether the provider lane is configured, how many expired records were purged, jobs claimed, and items refreshed. Running the worker with no chart or with the feature disabled makes no YouTube API call.

6. Reload `/inspiration` in English and Arabic. Verify provider order, YouTube attribution, source links, raw metrics, observed time, and that there is no Remix or Blitz action on these cards.

7. Pause and resume the source, queue a refresh, then delete it. Confirm the cards disappear. Set the feature flag to `false`, run the worker once, and confirm the summary reports erased entries.

## Scheduled worker

Invoke `GET` or `POST /api/studio/internal/youtube-trends?limit=20` with `x-studio-internal-secret` or the configured cron bearer credential. The worker uses short `SKIP LOCKED` transactions for scheduling and claiming, performs the external request outside any database transaction, and replaces a chart's complete current projection atomically.

Run the worker at least hourly. A frequent scheduler does not imply a provider call: only due sources are claimed. The source interval determines quota use.

`vercel.json` invokes this route every five minutes so queued manual refreshes
start promptly and due charts are not missed. That cadence does not increase
YouTube quota consumption: the worker schedules only sources whose persisted
`next_run_at` has passed, and every chart still follows its configured interval.
Licensed catalog imports use a separate one-minute materialization worker and
never cause a YouTube or generation-provider request.

## Release checklist

- Confirm YouTube Data API access and key restrictions in the correct single Google API Project.
- Review the current YouTube API Services Terms, Developer Policies, Branding Guidelines, and revision history.
- Verify public Terms and Privacy disclosures in both supported languages.
- Confirm the official YouTube attribution icon is visible and links to YouTube content.
- Confirm source links preserve referrer identity and no embedded player suppresses the required identity signal.
- Confirm database backups and operational exports follow the same deletion/retention policy.
- Do not connect this data to Brand scoring, inferred Arabic variety, Content Format classification, search embeddings, Remix, Blitz, or long-lived analytics unless the exact YouTube derived-metrics use case has been accepted in writing.

Primary references: [videos.list](https://developers.google.com/youtube/v3/docs/videos/list), [most-popular implementation guide](https://developers.google.com/youtube/v3/guides/implementation/videos), [Developer Policies](https://developers.google.com/youtube/terms/developer-policies), [compliance guide](https://developers.google.com/youtube/terms/developer-policies-guide), and [Branding Guidelines](https://developers.google.com/youtube/terms/branding-guidelines).

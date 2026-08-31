# Arabic-first onboarding rollout runbook

This runbook enables the verified, resumable onboarding journey without locking existing customers out of the product. The canonical implementation lives in `src/lib/onboarding`; browser code can only read a snapshot or submit a versioned command through `/api/onboarding`.

## Preflight

1. Deploy database migrations `0053_fearless_lightspeed.sql`, `0054_first_betty_ross.sql`, and `0055_amazing_lake.sql` in order.
2. Run `pnpm db:backfill:onboarding` before enabling product gates. It marks existing workspace members `completed_legacy`; rerunning it is safe.
3. Verify that every active production user with a workspace is either `completed`, `completed_legacy`, or intentionally in the new cohort.
4. Configure `RESEND_API_KEY`, `AUTH_FROM_EMAIL`, `AUTH_EMAIL_DELIVERY=resend`, and an approved sending domain. Never enable console email links outside local development.
5. Configure `ONBOARDING_LLM_MODEL` and the matching provider credential.
6. Confirm the Workflow webhook routes are reachable and the workflow manifest contains `executeOnboardingBrandAnalysis`.

## Cohort controls

- `ONBOARDING_INTERNAL_USER_IDS`: comma-separated Better Auth user IDs forced into onboarding for internal verification.
- `ONBOARDING_ROLLOUT_PERCENT`: deterministic percentage from `0` through `100`; the same user remains in the same bucket as the percentage grows.
- `ONBOARDING_KILL_SWITCH=true`: bypasses onboarding gates and provisions/retains the compatibility personal workspace. It does not delete onboarding sessions, sources, runs, or profiles.

Recommended progression:

1. Internal IDs with rollout `0`.
2. New test cohort at `1`.
3. Production at `10` after 24 hours of healthy verification and analysis metrics.
4. Increase to `50` after failure-code review and a manual Arabic/English smoke test.
5. Increase to `100` only after the legacy backfill count is reconciled against active workspace memberships.

Changing environment flags requires a new deployment. Do not change the hash algorithm or cohort salt during the rollout.

## Privacy-safe funnel queries

The `onboarding_analytics_events` table has fixed columns and checks. It cannot store website bodies, descriptions, URLs, prompts, model output, email tokens, or arbitrary JSON.

Verification completion by day:

```sql
select date_trunc('day', occurred_at) as day,
       count(*) filter (where event_name = 'verification_sent') as sent,
       count(*) filter (where event_name = 'verification_completed') as completed
from onboarding_analytics_events
where occurred_at >= now() - interval '30 days'
group by 1 order by 1;
```

Step drop-off and language choice:

```sql
select step, interface_locale, content_language,
       count(distinct session_id) as sessions
from onboarding_analytics_events
where event_name = 'step_viewed'
  and occurred_at >= now() - interval '14 days'
group by 1, 2, 3 order by 1, 2, 3;
```

Analysis latency and failures:

```sql
select stage,
       percentile_cont(0.5) within group (order by duration_ms) as p50_ms,
       percentile_cont(0.95) within group (order by duration_ms) as p95_ms
from onboarding_analytics_events
where event_name = 'analysis_stage_completed'
  and occurred_at >= now() - interval '7 days'
group by 1;

select failure_code, stage, count(*)
from onboarding_analytics_events
where event_name = 'analysis_failed'
  and occurred_at >= now() - interval '7 days'
group by 1, 2 order by 3 desc;
```

Time to first value:

```sql
with starts as (
  select user_id, min(occurred_at) as started_at
  from onboarding_analytics_events
  where event_name = 'signup_submitted'
  group by user_id
), first_value as (
  select user_id, min(occurred_at) as viewed_at
  from onboarding_analytics_events
  where event_name = 'first_value_viewed'
  group by user_id
)
select percentile_cont(0.5) within group
       (order by extract(epoch from (viewed_at - started_at))) as p50_seconds,
       percentile_cont(0.95) within group
       (order by extract(epoch from (viewed_at - started_at))) as p95_seconds
from starts join first_value using (user_id);
```

## Alert thresholds and recovery

- Verification completion below 70% over a rolling 6-hour window: verify Resend delivery and domain reputation; do not weaken verification.
- `SOURCE_BLOCKED`/`SOURCE_UNSUPPORTED`: keep the manual-description fallback visible; these are expected terminal source outcomes.
- Provider or `BRAND_PROFILE_*` failures above 5%: stop cohort growth, check provider health/configuration, and let users use the retry command.
- Workflow dispatch pending for more than 5 minutes: redispatch the same run from its pending outbox intent. Do not create a replacement source.
- Severe regression: set `ONBOARDING_KILL_SWITCH=true`, deploy, and preserve all saved state for later resumption.

## Acceptance evidence

Before each increase, run `pnpm test:run`, `pnpm typecheck`, `pnpm lint`, and `pnpm build`; apply migrations to a disposable Postgres database; then manually verify Arabic RTL, English LTR, website, description, blocked URL, retry, profile review, direct-route gate, and `/blitz` first value. Record screenshots in the release artifact rather than committing customer data to the repository.

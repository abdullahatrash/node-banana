# Release flag runtime

Production admitted generation requires `ADMITTED_GENERATION_RELEASE_FLAG_ID`. If it is absent, invalid, stale, expired, belongs to another signed-manifest build, or has a missing/cyclic dependency, the execution route returns a fail-closed service error before provider credentials or credits are touched.

The flag must be an active `release_control_records` revision with a safe-off default, explicit role/entitlement/locale eligibility, evidence, evaluation telemetry, rollback owner and threshold, and a current expiry. Cohorts are derived server-side from a pseudonymous subject, flag ID, and immutable flag revision. The durable assignment records the stable bucket; every entry-point decision is separately persisted with the exact role, entitlement, locale, result, and evaluation time.

Rollback is a new authoritative flag revision: set the affected flag to `retired` or its rollout to zero. Dependency evaluation is recursive, so rolling back a dependency disables every dependent slice immediately without touching provider credentials. Automatic rollback operators use the declared metric, threshold, window, and owner to append that revision; they must never mutate historical assignments or evaluations.

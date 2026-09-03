# Release promotion gate

Production promotion is fail-closed. `.github/workflows/production-deploy.yml` is the only supported production deployment path. Its deploy job has a hard `needs: release-gate` dependency and checks out, builds, and promotes the exact `${{ github.sha }}` accepted by the signed server-owned `release-manifest/v2`. Every release-quality and parity cell must pass before deployment can begin.

Configure the protected `production` GitHub Environment with `RELEASE_DEPLOYMENT_GATE_SECRET`, `RELEASE_READINESS_SIGNING_SECRET`, `RELEASE_READINESS_SIGNING_KEY_ID`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID`. Set `PRODUCTION_APP_URL` and `RELEASE_GATE_WORKSPACE_ID` as Environment variables. Configure the application with the matching release gate values plus the signed manifest variables documented in `.env.example`.

The workflow deliberately does not run for pull requests, so secrets are never exposed to forks. Pull requests run deterministic tests and build checks only. Production runs only for a protected `develop` push or a trusted manual dispatch. Missing secrets, non-HTTPS origins, stale decisions, build mismatches, invalid HMAC signatures, blockers, or incomplete parity all fail the required job.

Repository administrators must apply all of these controls outside the repository:

- Protect `develop`, require pull requests, and require the deterministic CI checks before merge.
- Protect the `production` Environment with required independent reviewers, prevent self-review, restrict deployment branches to `develop`, and keep all production secrets Environment-scoped.
- Disable Vercel’s direct Git production deployment for this project. Preview deployments may remain enabled, but the production alias must be promoted only by `production-deploy.yml`.
- Make `Production deployment / required signed readiness gate` and `Production deployment / deploy manifest-bound commit` required deployment checks.
- Rotate the gate and signing secrets independently. The readiness signing secret must never be available to the evidence collectors that sign the underlying attestations.

These provider-side protection settings cannot be expressed or verified solely by files in this repository. Until an administrator confirms them, the production process is not considered protected.

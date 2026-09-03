# Release promotion gate

Production promotion is fail-closed. A deployment workflow must call `.github/workflows/release-promotion.yml` and make its own deploy job depend on the reusable workflow's `promotion-authorized` job. The gate accepts only the exact immutable build ID carried by the signed server-owned `release-manifest/v2`; every release-quality and parity cell must pass before the endpoint returns success.

Configure the production GitHub Environment with `deployment_gate_secret`, `readiness_signing_secret`, and `readiness_signing_key_id`. Configure the application with their matching `RELEASE_DEPLOYMENT_GATE_SECRET`, `RELEASE_READINESS_SIGNING_SECRET`, and `RELEASE_READINESS_SIGNING_KEY_ID` values, plus the signed manifest variables documented in `.env.example`.

The workflow deliberately does not run for pull requests, so secrets are never exposed to forks. Pull requests run deterministic tests and build checks only. Promotion is a trusted `workflow_dispatch` or reusable `workflow_call` operation against the protected `production` Environment. Missing secrets, non-HTTPS origins, stale decisions, build mismatches, invalid HMAC signatures, blockers, or incomplete parity all fail the job.

Example deploy dependency:

```yaml
jobs:
  release-gate:
    uses: ./.github/workflows/release-promotion.yml
    with:
      gate_url: https://app.example.com
      workspace_id: production-release-workspace
      build_id: ${{ github.sha }}
    secrets:
      deployment_gate_secret: ${{ secrets.RELEASE_DEPLOYMENT_GATE_SECRET }}
      readiness_signing_secret: ${{ secrets.RELEASE_READINESS_SIGNING_SECRET }}
      readiness_signing_key_id: ${{ secrets.RELEASE_READINESS_SIGNING_KEY_ID }}
  deploy:
    needs: release-gate
    # deployment provider steps
```

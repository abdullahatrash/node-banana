# Provider processing-region evidence

Node Banana treats storage residency and provider processing geography as separate facts. A Workspace Data Region Policy may identify the primary asset-storage region while independently pinning the exact `processing/provider:replicate` route. The application never infers a provider region from the Workspace region or from a model/deployment name.

## What counts as evidence

Use a current, authoritative provider disclosure. Replicate's deployment API documents model version, hardware, and scaling configuration, but does not expose a deployment-region field. Replicate's subprocessor disclosure identifies provider and processing locations. Therefore, an operator must review the applicable disclosure and record its URL, content digest, and review timestamp; the product must not manufacture a more specific residency claim than the source supports.

- [Replicate deployments](https://replicate.com/docs/topics/deployments/)
- [Replicate HTTP API](https://replicate.com/docs/reference/http)
- [Replicate subprocessors](https://replicate.com/docs/topics/site-policy/subprocessors/)

## Configure the deployment

Set every region to the route's real deployment value. `PROVIDER_REGION_REPLICATE` must exactly match the signed `processing/provider:replicate` route.

```dotenv
S3_REGION=<workspace asset storage region>
APP_DATA_REGION=<application processing region>
GOVERNANCE_EXPORT_STORAGE_REGION=<governance export storage region>
GOVERNANCE_IMPORT_STORAGE_REGION=<workspace import storage region>
GOVERNANCE_IMPORT_PROCESSING_REGION=<workspace import processing region>
GOVERNANCE_DELETION_REGION=<deletion adapter region>
PROVIDER_REGION_REPLICATE=<reviewed Replicate processing region label>
GOVERNANCE_REGION_TRUST_KEYS={"region-key-2026-09":"<base64 32-byte HMAC key>"}
```

Keep the HMAC key in server-side secret storage. Do not paste it into the browser, commit it, or include it in the evidence document.

## Generate, review, and sign

1. Generate an unsigned manifest from the configured routes:

   ```bash
   pnpm governance:region-evidence -- --template > /tmp/node-banana-region-unsigned.json
   ```

2. Review every `REVIEW_REQUIRED` value. Replace it only with a value supported by the actual deployment or authoritative disclosure.
3. Download or otherwise capture the reviewed source representation, calculate its SHA-256 digest, and replace the placeholder source URL, digest, and `checkedAt` timestamp. Evidence review must be no more than 30 days old when signed.
4. Sign and locally verify the exact document:

   ```bash
   pnpm governance:region-evidence -- /tmp/node-banana-region-unsigned.json > /tmp/node-banana-region-signed.json
   ```

   Signing fails if a placeholder remains, the trust key is missing or shorter than 32 bytes, a route is missing, source evidence is stale, or the resulting signature does not verify.

5. In **Settings → Governance → Data**, request fresh secure confirmation, paste the signed JSON without changing it, and activate the policy.
6. Run `pnpm doctor:local`. The Replicate processing-region gate becomes ready only when `PROVIDER_REGION_REPLICATE` and the active, unexpired `processing/provider:replicate` evidence route match exactly.

Reissue the manifest whenever a route, provider disclosure, deployment, or trust key changes, and before its expiry. Activating a new manifest produces a new versioned governance record and does not rewrite prior audit evidence.

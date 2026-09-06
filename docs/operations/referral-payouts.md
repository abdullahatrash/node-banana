# Referral cash payouts

Node Banana owns referral attribution, reward qualification, immutable ledger
evidence, recipient-verification status, and payout-request state. It does not
store bank accounts, routing numbers, IBANs, legal names, or tax documents. A
separately controlled payout gateway owns those regulated provider details and
returns an opaque `providerRecipientRef` after verification.

## Gateway contract

Configure `REFERRAL_PAYOUT_GATEWAY_URL`, `REFERRAL_PAYOUT_GATEWAY_TOKEN`, and
`REFERRAL_PAYOUT_PROVIDER_NAME`. Production URLs must use HTTPS. The endpoint
accepts a bearer-authenticated `POST` with this exact command shape:

```json
{
  "schema": "referral-payout-command/v1",
  "action": "lookup",
  "provider": "provider.example",
  "idempotencyKey": "referral-payout:workspace-id:payout-id",
  "payoutRequestId": "payout-id",
  "providerRecipientRef": "opaque-provider-reference",
  "amountMinor": 12500,
  "currency": "USD",
  "requestEvidenceDigest": "sha256:..."
}
```

`action` is `lookup` or `submit`. Lookup must be a strongly consistent search
for the provider operation created with that idempotency key. A missing lookup
returns `kind: "not_found"`; it must not create a transfer. The gateway returns
the same provider name, idempotency key, payout-request ID, amount, currency,
and request-evidence digest in every response. Any mismatch is treated as an
ambiguous response and is never applied to the ledger.

```json
{
  "schema": "referral-payout-gateway/v1",
  "kind": "outcome",
  "provider": "provider.example",
  "idempotencyKey": "referral-payout:workspace-id:payout-id",
  "payoutRequestId": "payout-id",
  "amountMinor": 12500,
  "currency": "USD",
  "requestEvidenceDigest": "sha256:...",
  "outcome": {
    "state": "processing",
    "providerEventRef": "provider-event-id",
    "merchantPayoutRef": "provider-payout-id",
    "evidenceDigest": "sha256:...",
    "occurredAt": "2026-09-05T12:00:00.000Z"
  }
}
```

Allowed states are `processing`, `action_required`, `paid`, `failed_known`,
`outcome_unknown`, and `cancelled`. A `paid` outcome must include
`merchantPayoutRef`. Provider event references must be stable and replayable.

## Recovery invariant

The scheduled worker leases due requests with `FOR UPDATE SKIP LOCKED`. It
always performs `lookup` before the first `submit`. A lost or invalid lookup
response is safe to retry because lookup has no effect. A lost, invalid, or
non-successful submit response is recorded as `outcome_unknown`; its rewards
remain held and future workers perform lookup only. They never submit that
request again. Only `paid`, `failed_known`, or `cancelled` releases the hold;
`paid` also creates the final paid ledger entry.

Run one no-effect worker pass locally:

```bash
pnpm workers:local -- --url http://localhost:3002
```

When the gateway is unconfigured, the payout worker reports `unavailable` and
does not claim or mutate submitted requests.

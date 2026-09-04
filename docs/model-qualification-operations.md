# Replicate model qualification operations

Model qualification is an operator-only, explicitly paid procedure. Normal application startup, tests, catalog discovery, and `pnpm qualify:replicate <plan.json>` without the exact confirmation flag make no provider calls.

## Safety boundary

The only paid invocation is:

```bash
MODEL_QUALIFICATION_SIGNING_PRIVATE_KEY='<ephemeral Ed25519 PEM>' \
  pnpm qualify:replicate reviewed-plan.json --execute-paid-smoke
```

The literal `--execute-paid-smoke` flag is mandatory. Review the plan and its immutable Replicate version, real input schema digest, required Brand-reference fixtures, 9:16 cases, cancellation case, language coverage, license evidence, and pricing evidence before using it. Never run the command from CI, application startup, a fork, or an untrusted plan.

## Prerequisites

1. Apply database migrations through `0103_model_qualification_account_spend`.
2. Set a dedicated, least-privileged `REPLICATE_QUALIFICATION_API_TOKEN`. Customer BYOK credentials must never be used.
3. Configure the HTTPS webhook receiver, webhook observer, secure ingestion service, and spend observer with `QUALIFICATION_WEBHOOK_URL`, `QUALIFICATION_WEBHOOK_OBSERVER_URL`, `QUALIFICATION_INGESTION_URL`, and `QUALIFICATION_SPEND_OBSERVER_URL`.
4. Configure `QUALIFICATION_HARNESS_TOKEN` for those internal services.
5. Pin the spend observer's Ed25519 public keys in `QUALIFICATION_SPEND_RECEIPT_PUBLIC_KEYS_JSON`. The observer must bind signed preflight authorizations and observed receipts to the Replicate account, credential fingerprint, immutable model version, stable run/case identity, and prediction.
6. Supply `MODEL_QUALIFICATION_SIGNING_PRIVATE_KEY` only for the command invocation. Keep the corresponding public key in `MODEL_QUALIFICATION_PUBLIC_KEYS_JSON` for runtime verification.

## Durable account ceiling

The server-owned matrix ID `replicate-production-qualification/v1` has a strict account-wide ceiling below USD 0.40. Before any paid submission, the runner identifies the account using the configured Replicate credential, obtains signed maximum-cost authorizations for every cell, and atomically reserves the complete matrix budget across all runs for that account. Caller-declared maximums are not accepted.

After each prediction reaches a reconciled terminal state, the runner requires a signed provider-account billing receipt and records it append-only before proceeding. Unknown cost, an untrusted signature, an expired authorization, an unresolved provider outcome, missing Brand/reference coverage, or an unavailable durable ledger stops the matrix before another paid call. Completed runs count observed cost; incomplete runs retain their full reservation. Legacy qualification rows without verified account spend block new qualification until an operator reconciles them.

The runner never prints provider tokens, harness tokens, or signing private keys. Store the signed qualification envelope as reviewed configuration only after every matrix cell and receipt gate succeeds.

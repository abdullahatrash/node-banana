# Dynamically Register OAuth Apps on Mastodon Instances

Mastodon is federated — each instance runs its own OAuth server. When a user connects a Mastodon Channel, Node Banana will call `POST /api/v1/apps` on the user's instance to create an OAuth app on the fly, then store the resulting `client_id`, `client_secret`, and instance metadata (including `max_characters`) in a `social_mastodon_instances` table. Subsequent users on the same instance reuse the existing registration.

## Context

Postiz hardcodes a single Mastodon instance URL as an environment variable (`MASTODON_URL`), meaning each self-hosted deployment supports only one instance. This is a poor fit for a self-hosted tool where users may be on mastodon.social, fosstodon.org, hachyderm.io, or any custom instance.

Alternatives considered:

- **Pre-configured popular instances** — limits users to instances we register on in advance; defeats the point of federation.
- **Env var per instance (Postiz model)** — requires server config changes per instance; bad self-hosting experience.

## Decision

Use Mastodon's dynamic client registration API. Store per-instance credentials and configuration in a dedicated table rather than per-user account records, since the OAuth app is shared across all users on that instance.

The `social_mastodon_instances` table stores: `instance_url` (unique), `client_id`, `client_secret`, `max_characters`, `created_at`, `updated_at`.

## Consequences

- Any Mastodon-compatible server (Mastodon, Pleroma, Akkoma, GoToSocial) works without configuration.
- Self-hosting requires zero Mastodon-specific env vars.
- The table grows by one row per unique instance, which is bounded and slow-growing.
- If an instance revokes the app registration, all Channels on that instance break simultaneously — but this is rare and the fix is automatic re-registration on next connect attempt.

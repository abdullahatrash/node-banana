# @node-banana/cli (`nb`)

A small, dependency-light command-line client for the **Node Banana public API**.
It talks only to the hosted REST API (`/api/v1/*`) with a workspace-scoped API
token — it never touches the database or imports server code — so it exercises
exactly the same surface your agents and scripts use.

## Install

From a checkout of this monorepo:

```bash
pnpm install
pnpm --filter @node-banana/cli build
# run the built binary
node packages/cli/dist/index.js --help
# or link it as `nb`
cd packages/cli && npm link   # then: nb --help
```

## Authenticate

Create a workspace-scoped API token in the app (Workspace Settings → API
tokens), then:

```bash
# pass the token inline...
nb auth login --token nb_xxx --url https://app.example.com

# ...or omit --token to be prompted (input is hidden, never echoed)
nb auth login --url https://app.example.com

nb auth status        # show the stored URL + a masked token (offline)
```

The token and URL are stored **outside any repo**, at
`~/.config/node-banana/config.json` (honouring `XDG_CONFIG_HOME`, overridable
with `NB_CONFIG_DIR`) with `0600` permissions. `nb auth login` verifies the
token against the API before saving, so a stored credential always works.

## Commands

| Command | Description |
|---------|-------------|
| `nb auth login [--token <t>] [--url <u>]` | Store and verify an API token. |
| `nb auth status` | Show the current login state (offline, token masked). |
| `nb workspaces list` | List the workspace (brand) the token can reach. |
| `nb accounts list` | List connected social accounts (channels). |
| `nb assets list [--type <t>] [--limit <n>]` | List media assets; `--type` = image \| video \| audio \| model3d \| workflow. |
| `nb assets upload <file> [--type <t>] [--project-id <id>] [--mime-type <m>]` | Upload a local file as a workspace asset; type/mime are inferred from the extension if omitted. Enforces the workspace's storage quota and type rules. |
| `nb assets download-url <assetId> [--expires-in <seconds>]` | Get a CDN or presigned download URL for an existing asset. |

### Examples

```
$ nb workspaces list
ID    NAME         SLUG
ws_9  Acme Studio  acme-studio

$ nb accounts list
ID     PLATFORM  USERNAME  DISPLAY NAME  STATUS
acc_1  x         acmehq    Acme          connected

$ nb assets list --type image --limit 5
ID       TYPE   MIME       SIZE   CREATED
asset_7  image  image/png  20480  2026-06-01T00:00:00.000Z
```

## `--json` and CI usage

Every command accepts a global `--json` flag (before or after the subcommand)
that prints the exact API data as JSON — ideal for pipelines:

```bash
# machine-readable output
nb workspaces list --json
nb --json assets list --type video

# pipe into jq
nb accounts list --json | jq -r '.[].id'
```

Exit codes are stable for scripting:

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | The API rejected the request (auth, permission, not found, server) |
| `2` | The invocation was wrong (bad flag, missing arg, not logged in) |

Structured API errors are surfaced with an actionable `fix`, e.g.:

```
$ nb accounts list
Error: This token cannot access this resource.
  code: forbidden
  fix:  Use a token whose role grants social:view.
```

A typical CI step:

```bash
nb auth login --token "$NB_TOKEN" --url "$NB_URL" --json > /dev/null
nb assets list --type image --json > assets.json || exit 1
```

## Development

```bash
pnpm --filter @node-banana/cli test:run   # unit + smoke tests
pnpm --filter @node-banana/cli typecheck
pnpm --filter @node-banana/cli build
```

CLI tests also run as part of the repo-root `pnpm test:run`.

# Production build memory

The September 2026 CI failure occurred during Next.js's TypeScript check, after
webpack compiled successfully. It was reproduced on `develop@0573255b` with
Node 22.22.1, Next.js 16.1.6, TypeScript 5.9.3, and a 4096 MiB V8 old-space limit.

## Cause and fix

The YouTube provider imported `google` from the root `googleapis` entry. That
entry imports declarations for every supported Google API. The checker loaded
3,851,925 lines of dependency declarations, even though this adapter only needs
OAuth2 and YouTube. `skipLibCheck` was already enabled: it does not prevent the
compiler from loading imported declarations.

Importing the OAuth2 and YouTube modules from the existing locked SDK removes
about 3.23 million unrelated declaration lines. There is no dependency upgrade,
change to provider requests, exclusion of source/tests, or disabled type checking.
The root SDK remains installed; this change reduces the compiler's loaded graph,
not the package's disk size.

Next.js's cold type-checking function crashed before the change with
`Ineffective mark-compacts near heap limit` around 4042 MiB. With the scoped
imports it completed at 2.76 GiB heap used (an end-of-check measurement, not a
sampled peak). A complete production-like `next build --webpack` also passed
with a cleared `.next/cache` and the same 4096 MiB old-space limit, including
type checking, page generation, and output tracing. These are local macOS/Node
22 measurements; the Linux CI run remains the deployment-environment check.

## Verification and regression protection

CI caps both type checking and the production-like build at 4096 MiB. Its
standalone check is non-incremental and prints diagnostics, making dependency
growth visible. The YouTube unit tests and real-SDK HTTP contract tests also run
in CI to verify authentication, token refresh, uploads, and error handling.

To measure a cold standalone check on Node 22:

```sh
NODE_OPTIONS=--max-old-space-size=4096 pnpm typecheck --incremental false --extendedDiagnostics
```

Run this separately from `next build` or `next typegen`, which rewrite generated
route types. For an end-to-end build check, use the environment documented in
`.github/workflows/ci.yml` and run `pnpm build` with the same heap limit.

Google documents individual API modules in its
[client installation guide](https://github.com/googleapis/google-api-nodejs-client#installation).
If the SDK's module layout changes during an upgrade, preserve the narrow API
boundary, using its individual API packages if necessary; do not restore the
root catalog import. Next.js also documents
[build memory diagnostics](https://nextjs.org/docs/app/guides/memory-usage).

# Social-provider contract tests (MSW)

This directory holds the **opt-in** MSW (Mock Service Worker) harness used to
contract-test the social provider adapters in
`src/lib/social/providers/*.ts` against **mocked platform HTTP** instead of
`vi.mock` stubs.

- **Harness:** [`server.ts`](./server.ts) — `setupMswServer(...handlers)`
- **Reference implementation:** [`../../lib/social/providers/__tests__/x.contract.test.ts`](../../lib/social/providers/__tests__/x.contract.test.ts)

Issue #112 replicates this pattern for the eight remaining providers. Follow the
recipe below — it is intentionally mechanical.

---

## Why a second, separate test style?

Each provider already has a `*.test.ts` that replaces the vendor SDK wholesale
(`vi.mock("twitter-api-v2")`, `vi.mock("googleapis")`, …). Those are fast unit
tests but they assert against a **hand-written fake** of the platform, so they
can't catch a mismatch between what the SDK actually sends/receives and what the
provider expects.

The **contract** tests fill that gap. They run the *real* SDK / `fetch` code and
intercept HTTP at the network boundary, so the request signing, URL building,
JSON (de)serialisation, and — most importantly — the **real error objects** fed
into `classifyError()` are all exercised. When the platform SDK is upgraded, or
an API returns a shape we didn't expect, these tests are what break.

The two styles live side by side; the contract file is always named
`*.contract.test.ts`.

---

## Why the harness is opt-in (not global)

`vitest.config.ts` `setupFiles` is deliberately **not** touched. ~2,460 existing
tests mock the network with `vi.stubGlobal("fetch", ...)` / `vi.mock(...)`, and a
globally-active MSW interceptor would fight those stubs. Instead each contract
file calls `setupMswServer(...)`, which scopes MSW's `beforeAll`/`afterEach`/
`afterAll` lifecycle to that file only. Nothing outside a `*.contract.test.ts`
is affected.

`setupMswServer` starts with `onUnhandledRequest: "error"`, so any outbound
request that isn't explicitly mocked **fails the test** — a contract test can
never silently reach the real platform.

---

## The four scenario classes (the contract)

Every provider contract file must cover these four, because they map 1:1 to the
publish pipeline's retry semantics (`SocialErrorType` in `provider-interface.ts`):

| # | Scenario                  | What it proves                                              | Expected `classifyError().type` |
|---|---------------------------|------------------------------------------------------------|---------------------------------|
| 1 | **successful post publish** | A happy-path `post()` returns the right `PublishResult`.   | — (no error)                    |
| 2 | **token-refresh trigger**   | A real `401`/auth error is classified for re-auth.         | `refresh-token`                 |
| 3 | **rate-limit retry**        | A real `429` is classified as transient + retried.         | `retry`                         |
| 4 | **permanent-failure**       | A real content rejection (duplicate/policy) fails fast.    | `bad-body`                      |

For scenarios 2–4 the pattern is always: **drive `post()` → let the real SDK
throw → hand the caught error to `classifyError()` → assert the type.** Never
construct a synthetic `new Error("429 ...")`; the whole point is to feed
`classifyError()` the *real* error the platform produces.

> Guard against false positives: the default `classifyError()` bucket is also
> `"retry"`, so the rate-limit test additionally asserts the error text contains
> the status and that the returned `message` is the distinct rate-limit copy —
> otherwise an unrelated failure could pass as "rate-limit handling".

---

## Recipe for a new provider (issue #112)

1. **Find the platform's real base URLs and endpoints.** Read the SDK the
   provider imports (or its `fetch` calls). For SDKs, grep the package for its
   URL constants, e.g. for X:
   ```bash
   grep -rn "PREFIX\|api\." node_modules/<sdk>/dist/**/globals.js
   ```
   Note the create-post endpoint, the "who am I" endpoint (if used for the post
   URL), and any media-upload endpoints.

2. **Learn the SDK's error shape.** Find where it throws on non-2xx and what the
   `.message` looks like — that string is what `classifyError()` pattern-matches.
   For `twitter-api-v2` it is `"Request failed with code <status> - <title>: <detail>"`.
   Craft your error-response bodies so the resulting message contains the tokens
   the provider's `classifyError()` looks for (`429`, `401`, `duplicate`, …).

3. **Copy `x.contract.test.ts`** to `<provider>.contract.test.ts` and adapt:
   - Keep the `// @vitest-environment node` docblock on line 1. Providers use
     Node HTTP/SDKs; the `node` environment avoids jsdom's `fetch`/DOM
     interfering with interception. (Providers that are pure `fetch` also work
     in `node`.)
   - Replace the endpoint constants and the happy-path default handlers passed
     to `setupMswServer(...)`.
   - Set whatever env vars the provider reads (API keys/secrets) in
     `beforeEach`, and `clearRegistry()` so module-load registration is clean.
   - Override per-scenario with `server.use(http.<method>(URL, () => HttpResponse.json(..., { status }))))`.

4. **Do NOT modify provider code.** If a contract test can only pass by changing
   the provider, you've found a real defect — report it, don't paper over it.

5. **Run just your file while iterating**, then the whole suite before finishing:
   ```bash
   npx vitest run src/lib/social/providers/__tests__/<provider>.contract.test.ts
   pnpm test:run
   ```

## Notes / gotchas

- **Media uploads** (X `v2.uploadMedia`, etc.) use multi-step *chunked* upload
  endpoints (`media/upload/initialize|append|finalize`) and require the real
  image bytes to survive `sharp`. The X contract file covers the text-only happy
  path (no `sharp`, single `tweets` call) plus the three error paths, which is
  sufficient for the four contract classes. If you add a media happy-path test,
  mock every step of the chunked flow and feed `sharp` a real (tiny) image.
- `onUnhandledRequest: "error"` means you must mock **every** endpoint the flow
  touches (e.g. X's post path also calls `users/me` for the post URL).

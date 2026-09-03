# Localization contract

Tasmeemai ships authored Arabic and English interface catalogs. Arabic (`ar`) is the default interface locale; content language and Arabic variety are separate product concepts.

## Adding customer-facing copy

1. Add the same semantic key and ICU variables to `messages/ar.json` and `messages/en.json`.
2. Use `useTranslations` in client components or the `next-intl/server` APIs in server components.
3. Use `getLocalizedErrorMessage` for canonical validation/capability errors and `renderNotification` for delivery templates.
4. Wrap mixed-direction values with the helpers in `bidi.ts`, and render user-authored blocks with `dir="auto"`.
5. Format values through `format.ts`; do not infer a country, calendar, timezone, week start, or numeral system merely from Arabic.
6. Run `pnpm i18n:check`. Catalog/key drift and new literal-bearing surface files fail this gate. When a migrated legacy file no longer contains governed literals, remove it from the corresponding allowlist.

Released copy must not use runtime machine translation. Missing production messages fall back to the other authored catalog, emit a structured localization incident, and never display the semantic key.

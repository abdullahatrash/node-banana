import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  globalIgnores([
    "node_modules/**",
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "drizzle/**",
    "public/**",
    "scripts/**",
    ".superpowers/**",
  ]),
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{js,jsx,ts,tsx}"],
    rules: {
      // Many API routes/store code intentionally use `any` for provider payloads
      // (external API responses, dynamic node data). Downgrading to warn keeps
      // the signal without blocking `pnpm lint` on pre-existing, low-risk usage.
      "@typescript-eslint/no-explicit-any": "warn",
      // Unused function args are common in typed callback signatures (e.g. React
      // Flow handlers, route handlers) where the full signature must be kept
      // for type compatibility even when a param is unused.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // eslint-plugin-react-hooks v7's "recommended" preset bundles a large family
      // of React Compiler readiness diagnostics (set-state-in-effect, refs, purity,
      // globals, immutability, preserve-manual-memoization, static-components,
      // use-memo, error-boundaries, set-state-in-render, config, gating) on top of
      // the classic rules-of-hooks/exhaustive-deps rules. This project does not
      // build with the React Compiler (see CLAUDE.md core stack), so these are
      // pure noise against ~100 pre-existing, intentional patterns rather than
      // real bugs. Keep rules-of-hooks (error) and exhaustive-deps (warn); turn
      // off the compiler-only diagnostics.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/immutability": "off",
      "react-hooks/purity": "off",
      "react-hooks/globals": "off",
      "react-hooks/static-components": "off",
      "react-hooks/use-memo": "off",
      "react-hooks/error-boundaries": "off",
      "react-hooks/set-state-in-render": "off",
      "react-hooks/config": "off",
      "react-hooks/gating": "off",
      "react-hooks/incompatible-library": "off",
    },
  },
  {
    // Vitest's `vi.mock()` factories are hoisted above imports and must return
    // their mock synchronously, so the standard pattern is a synchronous
    // `require()` inside the factory rather than a top-level import.
    files: ["src/**/*.test.{ts,tsx}", "src/**/__tests__/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
]);

export default eslintConfig;

/**
 * Runtime bootstrap for social providers.
 *
 * Import this module from server entrypoints (API routes/workflows) before
 * using provider-registry so adapters are registered deterministically.
 */
import "@/lib/social/providers";

export const socialProvidersBootstrapped = true;

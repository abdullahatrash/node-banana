import { logger } from "@/utils/logger";

/**
 * Legacy provider code historically built rich console arguments. Keep its
 * control flow intact while making the logging boundary fail closed: none of
 * those arguments are inspected, stored, or forwarded.
 */
export const safeGenerationLog = {
  log(..._unsafe: unknown[]): void {
    logger.info("api.llm", "Generation provider event");
  },
  warn(..._unsafe: unknown[]): void {
    logger.warn("api.llm", "Generation provider warning");
  },
  error(..._unsafe: unknown[]): void {
    logger.error("api.error", "Generation provider failure");
  },
} as const;

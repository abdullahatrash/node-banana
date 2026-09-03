import { getDb } from "@/lib/db";
import { ReleaseControlRepository } from "./repository";
import { ReleaseControlService } from "./service";

const secret = process.env.TELEMETRY_PSEUDONYM_SECRET || process.env.BETTER_AUTH_SECRET;
export function getReleaseControlService(): ReleaseControlService {
  if (!secret && process.env.NODE_ENV === "production") throw new Error("TELEMETRY_PSEUDONYM_SECRET is required.");
  return new ReleaseControlService(new ReleaseControlRepository(getDb), secret || "development-only-telemetry-secret");
}

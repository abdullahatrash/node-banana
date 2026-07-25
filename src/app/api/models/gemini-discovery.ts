import type { ModelCapability, ProviderModel } from "@/lib/providers";
import { humanize } from "./model-name";

const GEMINI_API_BASE =
  "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_DISCOVERY_TIMEOUT_MS = 5000;

interface GeminiDiscoveryModel {
  name: string;
  supportedGenerationMethods?: string[];
}

interface GeminiDiscoveryResponse {
  models?: GeminiDiscoveryModel[];
  nextPageToken?: string;
}

function inferGeminiCapabilities(id: string): ModelCapability[] | null {
  const lower = id.toLowerCase();
  if (lower.includes("image")) {
    return ["text-to-image", "image-to-image"];
  }
  if (lower.startsWith("veo-") || lower.includes("video")) {
    return ["text-to-video", "image-to-video"];
  }
  return null;
}

export async function fetchGeminiModels(
  apiKey: string,
): Promise<ProviderModel[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    GEMINI_DISCOVERY_TIMEOUT_MS,
  );

  try {
    const discovered: ProviderModel[] = [];
    let pageToken: string | undefined;
    let pageCount = 0;
    const maxPages = 10;

    do {
      const url = new URL(`${GEMINI_API_BASE}/models`);
      url.searchParams.set("pageSize", "100");
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const response = await fetch(url.toString(), {
        signal: controller.signal,
        headers: { "x-goog-api-key": apiKey },
      });
      if (!response.ok) {
        console.warn(`[Models] gemini: discovery HTTP ${response.status}`);
        return [];
      }

      const data = (await response.json()) as GeminiDiscoveryResponse;
      for (const model of data.models ?? []) {
        const rawId = model.name.replace(/^models\//, "");
        const capabilities = inferGeminiCapabilities(rawId);
        if (!capabilities) continue;

        discovered.push({
          id: rawId,
          name: humanize(rawId),
          description:
            "Newly discovered Gemini model. Metadata may be incomplete.",
          provider: "gemini",
          capabilities,
        });
      }

      pageToken = data.nextPageToken;
      pageCount++;
    } while (pageToken && pageCount < maxPages);

    return discovered;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    console.warn(`[Models] gemini: discovery failed: ${message}`);
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}

import { createAdmittedGenerationPost } from "@/lib/model-routing/admitted-generation-http";

export const maxDuration = 60;

export const POST = createAdmittedGenerationPost("/api/studio/copy");

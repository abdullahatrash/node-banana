// @vitest-environment node
import { describe, expect, it } from "vitest";
import { validateCreativeTextOutput } from "@/lib/model-routing/text-output-receipts";
import { copy } from "./fixtures";

describe("structured copy usability before credit settlement", () => {
  const intent = { contentLanguage: "mixed" as const, arabicVariety: "gulf" as const };
  it("accepts only the exact requested language/variety contract", () => {
    expect(() => validateCreativeTextOutput(JSON.stringify(copy()), intent)).not.toThrow();
    expect(() => validateCreativeTextOutput(JSON.stringify(copy("en")), intent)).toThrow("CREATIVE_TEXT_OUTPUT_INVALID");
  });
  it("fails malformed, unstructured and hostile copy before success can settle credits", () => {
    expect(() => validateCreativeTextOutput("ordinary text", intent)).toThrow("CREATIVE_TEXT_OUTPUT_INVALID");
    const hostile = copy(); hostile.blocks[0]!.spans[0]!.text += "\u202e";
    expect(() => validateCreativeTextOutput(JSON.stringify(hostile), intent)).toThrow("CREATIVE_TEXT_OUTPUT_INVALID");
  });
});

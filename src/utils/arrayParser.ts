import type { ArraySplitMode } from "@/types";

export interface ParseArrayOptions {
  splitMode: ArraySplitMode;
  delimiter: string;
  regexPattern: string;
  trimItems: boolean;
  removeEmpty: boolean;
}

export interface ParseArrayResult {
  items: string[];
  error: string | null;
}

const MAX_REGEX_PATTERN_LENGTH = 100;

function parseRegexPattern(pattern: string): RegExp {
  // Supports `/pattern/flags` and plain `pattern`.
  const slashFormat = pattern.match(/^\/(.+)\/([a-z]*)$/i);
  if (slashFormat) {
    return new RegExp(slashFormat[1], slashFormat[2]);
  }
  return new RegExp(pattern);
}

export function parseTextToArray(
  inputText: string | null | undefined,
  options: ParseArrayOptions
): ParseArrayResult {
  const source = inputText ?? "";
  if (!source) {
    return { items: [], error: null };
  }

  let rawItems: string[];

  try {
    if (options.splitMode === "newline") {
      rawItems = source.split(/\r?\n/);
    } else if (options.splitMode === "regex") {
      if (!options.regexPattern) {
        rawItems = [source];
      } else if (options.regexPattern.length > MAX_REGEX_PATTERN_LENGTH) {
        return {
          items: [],
          error: `Regex pattern too long (max ${MAX_REGEX_PATTERN_LENGTH} characters)`,
        };
      } else {
        rawItems = source.split(parseRegexPattern(options.regexPattern));
      }
    } else {
      // Delimiter mode
      if (!options.delimiter) {
        rawItems = [source];
      } else {
        rawItems = source.split(options.delimiter);
      }
    }
  } catch (error) {
    return {
      items: [],
      error: error instanceof Error ? error.message : "Invalid split pattern",
    };
  }

  let items = rawItems;
  if (options.trimItems) {
    items = items.map((item) => item.trim());
  }
  if (options.removeEmpty) {
    items = items.filter((item) => item.length > 0);
  }

  return { items, error: null };
}

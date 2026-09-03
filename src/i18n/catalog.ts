import ar from "./messages/ar.json";
import en from "./messages/en.json";
import type { AppLocale } from "./config";
import {
  parse,
  TYPE,
  type MessageFormatElement,
} from "@formatjs/icu-messageformat-parser";

export const catalogs = { ar, en } as const;

function flatten(value: unknown, prefix = "", result = new Map<string, string>()) {
  if (typeof value === "string") {
    result.set(prefix, value);
    return result;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, result);
    }
  }
  return result;
}

function collectVariables(elements: MessageFormatElement[], result = new Set<string>()) {
  for (const element of elements) {
    if (
      element.type === TYPE.argument ||
      element.type === TYPE.number ||
      element.type === TYPE.date ||
      element.type === TYPE.time ||
      element.type === TYPE.select ||
      element.type === TYPE.plural
    ) {
      result.add(element.value);
    }
    if (element.type === TYPE.select || element.type === TYPE.plural) {
      for (const option of Object.values(element.options)) collectVariables(option.value, result);
    } else if (element.type === TYPE.tag) {
      collectVariables(element.children, result);
    }
  }
  return result;
}

function variables(message: string) {
  return [...collectVariables(parse(message))].sort();
}

export function validateCatalogs() {
  const flattened = Object.fromEntries(Object.entries(catalogs).map(([locale, catalog]) => [locale, flatten(catalog)])) as Record<AppLocale, Map<string, string>>;
  const expected = [...flattened.en.keys()].sort();
  const errors: string[] = [];
  for (const locale of Object.keys(flattened) as AppLocale[]) {
    const actual = [...flattened[locale].keys()].sort();
    for (const missing of expected.filter((key) => !flattened[locale].has(key))) errors.push(`${locale}: missing ${missing}`);
    for (const extra of actual.filter((key) => !flattened.en.has(key))) errors.push(`${locale}: unexpected ${extra}`);
    for (const key of expected) {
      const baseline = flattened.en.get(key);
      const translated = flattened[locale].get(key);
      if (baseline && translated && variables(baseline).join(",") !== variables(translated).join(",")) errors.push(`${locale}: interpolation mismatch ${key}`);
    }
  }
  return errors;
}

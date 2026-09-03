import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parse, TYPE } from "@formatjs/icu-messageformat-parser";
import ts from "typescript";

const root = process.cwd();
const surfaceRoots = ["src/app", "src/components"];
const arabic = /[\u0600-\u06ff]/u;

const readJson = async (file) => JSON.parse(await readFile(path.join(root, file), "utf8"));
const [ar, en, legacyLiterals, legacyVisibleLiteralFiles] = await Promise.all([
  readJson("src/i18n/messages/ar.json"),
  readJson("src/i18n/messages/en.json"),
  readJson("src/i18n/legacy-literals.json"),
  readJson("src/i18n/legacy-visible-literal-files.json"),
]);

function flatten(value, prefix = "", result = new Map()) {
  if (typeof value === "string") result.set(prefix, value);
  else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) flatten(child, prefix ? `${prefix}.${key}` : key, result);
  }
  return result;
}

function collectVariables(elements, result = new Set()) {
  for (const element of elements) {
    if ([TYPE.argument, TYPE.number, TYPE.date, TYPE.time, TYPE.select, TYPE.plural].includes(element.type)) {
      result.add(element.value);
    }
    if (element.type === TYPE.select || element.type === TYPE.plural) {
      for (const option of Object.values(element.options)) collectVariables(option.value, result);
    } else if (element.type === TYPE.tag) collectVariables(element.children, result);
  }
  return result;
}
const variables = (message) => [...collectVariables(parse(message))].sort();
const flattened = { ar: flatten(ar), en: flatten(en) };
const expectedKeys = [...flattened.en.keys()].sort();
const errors = [];
for (const locale of ["ar", "en"]) {
  for (const key of expectedKeys) {
    const baseline = flattened.en.get(key);
    const translated = flattened[locale].get(key);
    if (!translated) errors.push(`${locale}: missing ${key}`);
    else if (variables(baseline).join(",") !== variables(translated).join(",")) errors.push(`${locale}: interpolation mismatch ${key}`);
  }
  for (const key of flattened[locale].keys()) if (!flattened.en.has(key)) errors.push(`${locale}: unexpected ${key}`);
}

async function sourceFiles(directory) {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(relative);
    return /\.(ts|tsx)$/.test(entry.name) && !/(__tests__|\.test\.)/.test(relative) ? [relative] : [];
  }))).flat();
}

const files = (await Promise.all(surfaceRoots.map(sourceFiles))).flat();
const currentLegacy = [];
for (const file of files) if (arabic.test(await readFile(path.join(root, file), "utf8"))) currentLegacy.push(file);
currentLegacy.sort();
const expectedLegacy = [...legacyLiterals].sort();
for (const file of currentLegacy.filter((file) => !expectedLegacy.includes(file))) errors.push(`new inline Arabic literal debt: ${file}`);
for (const file of expectedLegacy.filter((file) => !currentLegacy.includes(file))) errors.push(`remove migrated file from legacy-literals.json: ${file}`);

const visibleAttributes = new Set(["placeholder", "title", "aria-label", "alt"]);
function hasVisibleLiteral(file, source) {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found = false;
  function visit(node) {
    if (ts.isJsxText(node) && /[A-Za-z\u0600-\u06ff]{2}/u.test(node.text.trim())) found = true;
    if (
      ts.isJsxAttribute(node) &&
      visibleAttributes.has(node.name.text) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer) &&
      /[A-Za-z\u0600-\u06ff]{2}/u.test(node.initializer.text)
    ) found = true;
    if (!found) ts.forEachChild(node, visit);
  }
  visit(ast);
  return found;
}

const visibleLiteralFiles = [];
for (const file of files) {
  const source = await readFile(path.join(root, file), "utf8");
  if (file.endsWith(".tsx") && hasVisibleLiteral(file, source)) visibleLiteralFiles.push(file);
}
visibleLiteralFiles.sort();
const expectedVisibleLiteralFiles = [...legacyVisibleLiteralFiles].sort();
for (const file of visibleLiteralFiles.filter((file) => !expectedVisibleLiteralFiles.includes(file))) {
  errors.push(`new inline customer-facing literal debt: ${file}`);
}
for (const file of expectedVisibleLiteralFiles.filter((file) => !visibleLiteralFiles.includes(file))) {
  errors.push(`remove migrated file from legacy-visible-literal-files.json: ${file}`);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.info(`i18n catalogs match; ${currentLegacy.length} Arabic and ${visibleLiteralFiles.length} visible legacy literal files remain allowlisted`);
}

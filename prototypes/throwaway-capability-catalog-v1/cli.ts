/**
 * THROWAWAY PROTOTYPE.
 *
 * Tiny terminal explorer for the candidate Application Capability catalog.
 */

import {
  CANDIDATE_CAPABILITIES,
  CANDIDATE_RECIPES,
  TRANSPORTS,
  approvalWalkthrough,
  catalogSummary,
  idempotencyWalkthrough,
  mapInvocation,
  sampleInvocation,
  sampleError,
  sampleDispatch,
  sampleResult,
  validateCatalog,
  type Transport,
} from "./catalog";

const bold = "\u001b[1m";
const dim = "\u001b[2m";
const cyan = "\u001b[36m";
const reset = "\u001b[0m";

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function validateOnly(): void {
  const errors = validateCatalog();
  printJson({
    valid: errors.length === 0,
    errors,
    summary: catalogSummary(),
  });
  if (errors.length > 0) process.exitCode = 1;
}

function dump(): void {
  const errors = validateCatalog();
  printJson({
    prototype: "throwaway-capability-catalog-v1",
    valid: errors.length === 0,
    errors,
    summary: catalogSummary(),
    capabilities: CANDIDATE_CAPABILITIES,
    recipes: CANDIDATE_RECIPES,
  });
  if (errors.length > 0) process.exitCode = 1;
}

let selectedIndex = 0;
let transportIndex = 0;
let showMapping = true;

function selectedTransport(): Transport {
  return TRANSPORTS[transportIndex];
}

function render(): void {
  const definition = CANDIDATE_CAPABILITIES[selectedIndex];
  const transport = selectedTransport();
  const errors = validateCatalog();

  console.clear();
  console.log(`${bold}THROWAWAY — Application Capability catalog v1${reset}`);
  console.log(
    `${dim}Question: can every agent and Cockpit action share this exact contract?${reset}`,
  );
  console.log(
    `${dim}${selectedIndex + 1}/${CANDIDATE_CAPABILITIES.length} capabilities` +
      ` · transport ${transport}` +
      ` · catalog ${errors.length === 0 ? "valid" : "INVALID"}${reset}\n`,
  );

  console.log(
    `${bold}${cyan}${definition.id}@${definition.version}${reset}  ${definition.summary}`,
  );
  console.log(`domain       ${definition.domain}`);
  console.log(`digest       ${definition.contractDigest}`);
  console.log(
    `lifecycle    ${definition.lifecycle.status}` +
      `${definition.lifecycle.recommended ? " (recommended)" : ""}`,
  );
  console.log(`input        ${definition.inputSchema}`);
  console.log(`output       ${definition.outputSchema}`);
  console.log(`errors       ${definition.errorSet}`);
  console.log(`effect`);
  console.log(
    JSON.stringify(definition.effect, null, 2)
      .split("\n")
      .map((line) => `             ${line}`)
      .join("\n"),
  );
  console.log(`idempotency  ${definition.idempotency}`);
  console.log(`execution    ${definition.execution}`);
  console.log(`observation  ${definition.observation}`);
  console.log(`approval     ${definition.approval}`);
  console.log(`principals   ${definition.principalKinds.join(", ")}`);
  console.log(
    `scopes       ${definition.requiredScopes.join(", ") || "(discovery bootstrap)"}`,
  );
  console.log(`audit event  ${definition.auditEvent}`);
  console.log(`resource     ${definition.returnsResource ?? "—"}`);
  console.log(
    `inspect      ${
      definition.inspectCapability
        ? `${definition.inspectCapability.id}@${definition.inspectCapability.version}`
        : "—"
    }`,
  );
  console.log(
    `events       ${
      definition.eventCapability
        ? `${definition.eventCapability.id}@${definition.eventCapability.version}`
        : "—"
    }`,
  );

  console.log(`\n${bold}Catalog state${reset}`);
  printJson(catalogSummary());

  if (showMapping) {
    console.log(`\n${bold}Canonical invocation${reset}`);
    printJson(sampleInvocation(definition));
    console.log(`\n${bold}Dispatcher input after authentication${reset}`);
    printJson(sampleDispatch(definition));
    console.log(`\n${bold}Canonical result${reset}`);
    printJson(sampleResult(definition));
    console.log(`\n${bold}Canonical error${reset}`);
    printJson(sampleError(definition));
    console.log(`\n${bold}${transport.toUpperCase()} adapter mapping${reset}`);
    printJson(mapInvocation(definition, transport));
    console.log(`\n${bold}Idempotency behavior${reset}`);
    printJson(idempotencyWalkthrough(definition));
    console.log(`\n${bold}Approval behavior${reset}`);
    printJson(approvalWalkthrough(definition));
  }

  console.log(
    `\n${bold}[j/↓]${reset} ${dim}next${reset}  ` +
      `${bold}[k/↑]${reset} ${dim}previous${reset}  ` +
      `${bold}[t]${reset} ${dim}transport${reset}  ` +
      `${bold}[m]${reset} ${dim}mapping${reset}  ` +
      `${bold}[q]${reset} ${dim}quit${reset}`,
  );
}

function quit(): void {
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.pause();
  console.clear();
}

function interactive(): void {
  if (!process.stdin.isTTY) {
    validateOnly();
    return;
  }

  process.stdin.setEncoding("utf8");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  render();

  process.stdin.on("data", (key: string) => {
    if (key === "q" || key === "\u0003") {
      quit();
      return;
    }
    if (key === "j" || key === "\u001b[B") {
      selectedIndex = (selectedIndex + 1) % CANDIDATE_CAPABILITIES.length;
    } else if (key === "k" || key === "\u001b[A") {
      selectedIndex =
        (selectedIndex - 1 + CANDIDATE_CAPABILITIES.length) %
        CANDIDATE_CAPABILITIES.length;
    } else if (key === "t") {
      transportIndex = (transportIndex + 1) % TRANSPORTS.length;
    } else if (key === "m") {
      showMapping = !showMapping;
    }
    render();
  });
}

if (process.argv.includes("--validate")) validateOnly();
else if (process.argv.includes("--dump")) dump();
else interactive();

/**
 * THROWAWAY PROTOTYPE.
 *
 * Tiny TUI for comparing durable runtime/package boundaries.
 */

import {
  ARCHITECTURES,
  SCENARIOS,
  comparisonMatrix,
  evaluateScenario,
  validateModel,
} from "./model";

const bold = "\u001b[1m";
const dim = "\u001b[2m";
const cyan = "\u001b[36m";
const green = "\u001b[32m";
const red = "\u001b[31m";
const reset = "\u001b[0m";

let architectureIndex = 0;
let scenarioIndex = 0;
let showDetails = true;

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function validateOnly(): void {
  const errors = validateModel();
  printJson({
    valid: errors.length === 0,
    errors,
    architectures: ARCHITECTURES.length,
    scenarios: SCENARIOS.length,
    matrix: comparisonMatrix(),
  });
  if (errors.length > 0) process.exitCode = 1;
}

function matrixOnly(): void {
  printJson(comparisonMatrix());
}

function render(): void {
  const architecture = ARCHITECTURES[architectureIndex];
  const scenario = SCENARIOS[scenarioIndex];
  const evaluation = evaluateScenario(architecture, scenario);

  console.clear();
  console.log(`${bold}THROWAWAY — Durable runtime boundary v1${reset}`);
  console.log(
    `${dim}Question: which boundary survives the agreed runtime failures?${reset}`,
  );
  console.log(
    `${dim}${architectureIndex + 1}/${ARCHITECTURES.length} architectures · ` +
      `${scenarioIndex + 1}/${SCENARIOS.length} scenarios${reset}\n`,
  );

  console.log(`${bold}${cyan}${architecture.name}${reset}`);
  console.log(architecture.summary);
  console.log(`\n${bold}Domain authority${reset}       ${architecture.domainAuthority}`);
  console.log(
    `${bold}Orchestration authority${reset} ${architecture.orchestrationAuthority}`,
  );
  console.log(`${bold}Call path${reset}              ${architecture.callPath}`);

  console.log(`\n${bold}Scenario: ${scenario.name}${reset}`);
  console.log(`${dim}${scenario.stimulus}${reset}`);
  console.log(`Required: ${scenario.requiredOutcome}`);
  const color = evaluation.verdict === "fails" ? red : green;
  console.log(`Verdict:  ${color}${evaluation.verdict}${reset}`);

  console.log(`\n${bold}Invariant state${reset}`);
  for (const result of evaluation.invariantResults) {
    console.log(
      `  ${result.passed ? `${green}✓${reset}` : `${red}✗${reset}`} ` +
        result.invariant,
    );
  }

  if (showDetails) {
    console.log(`\n${bold}Failure trace${reset}`);
    for (const step of evaluation.trace) console.log(`  → ${step}`);

    console.log(`\n${bold}Package boundary${reset}`);
    for (const boundary of architecture.packageBoundary) {
      console.log(`  - ${boundary}`);
    }

    console.log(`\n${bold}Known costs${reset}`);
    for (const cost of architecture.knownCosts) console.log(`  - ${cost}`);
  }

  console.log(
    `\n${bold}[j/↓]${reset} ${dim}next architecture${reset}  ` +
      `${bold}[k/↑]${reset} ${dim}previous${reset}  ` +
      `${bold}[s]${reset} ${dim}scenario${reset}  ` +
      `${bold}[d]${reset} ${dim}details${reset}  ` +
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
      architectureIndex = (architectureIndex + 1) % ARCHITECTURES.length;
    } else if (key === "k" || key === "\u001b[A") {
      architectureIndex =
        (architectureIndex - 1 + ARCHITECTURES.length) %
        ARCHITECTURES.length;
    } else if (key === "s") {
      scenarioIndex = (scenarioIndex + 1) % SCENARIOS.length;
    } else if (key === "d") {
      showDetails = !showDetails;
    }
    render();
  });
}

if (process.argv.includes("--validate")) validateOnly();
else if (process.argv.includes("--matrix")) matrixOnly();
else interactive();

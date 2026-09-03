import fs from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

const workflow = fs.readFileSync(new URL("../.github/workflows/production-deploy.yml", import.meta.url), "utf8");
const gate = fs.readFileSync(new URL("../.github/workflows/release-promotion.yml", import.meta.url), "utf8");

test("production deployment is hard-dependent on signed readiness for the exact commit", () => {
  assert.match(workflow, /release-gate:[\s\S]*uses: \.\/\.github\/workflows\/release-promotion\.yml/);
  assert.match(workflow, /build_id: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /deploy:[\s\S]*needs: release-gate/);
  assert.match(workflow, /checkout@v4[\s\S]*ref: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /deploy --prebuilt --prod/);
});

test("the reusable gate cannot accept a caller-controlled origin", () => {
  assert.doesNotMatch(gate, /gate_url:/);
  assert.match(gate, /RELEASE_GATE_ORIGIN: \$\{\{ vars\.PRODUCTION_RELEASE_GATE_ORIGIN \}\}/);
  assert.match(gate, /RELEASE_GATE_ALLOWED_HOSTS: \$\{\{ vars\.PRODUCTION_RELEASE_GATE_ALLOWED_HOSTS \}\}/);
  assert.match(fs.readFileSync(new URL("./verify-release-promotion.mjs", import.meta.url), "utf8"), /redirect: "error"/);
});

test("production secrets cannot run in fork pull requests", () => {
  assert.doesNotMatch(workflow, /pull_request:/);
  assert.match(workflow, /branches: \[develop\]/);
  assert.match(workflow, /environment: production/);
});

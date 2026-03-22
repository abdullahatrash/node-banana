# ContentOS Implementation Plan on Top of Node Banana

## 1) Current State Audit (What We Already Have)

This repository is already a strong foundation for **Pillar 1 (AI Content Studio)**:

- Visual workflow canvas with many node types (image/text/video/audio/3D flow)
- Workflow execution engine with dependency ordering and per-node executors
- AI generation APIs (`/api/generate`, `/api/llm`) and multi-provider support
- Quickstart workflow generation (`/api/quickstart`) and template flow
- Local project/file persistence (`/api/workflow`, `/api/save-generation`, `/api/workflow-images`)
- Significant automated coverage with Vitest

Current gaps discovered during validation:

- Test suite is not fully green today:
  - Missing dependency import path (`zod` used in `src/lib/chat/tools.ts`)
  - One UI test mismatch in welcome modal backdrop class
- No production-grade end-to-end smoke tests for the full user workflow
- No auth, workspace/multi-tenant backend, DB, job queue, or social publishing domains yet

## 2) Pillar Roadmap (From PRDS to Delivery)

### Pillar 1: AI Content Studio (P0) - Build on existing base
- **Status:** In progress / strongest pillar already
- **Goal:** Make creation workflow reliable end-to-end for real users
- **Scope now:** Hardening + UX reliability + test automation + media lifecycle

### Pillar 2: Social Media Hub (P0)
- **Status:** Not started in this repo
- **Goal:** Connect accounts and publish/schedule content
- **First slice:** Instagram + X + LinkedIn connect + schedule + publish worker

### Pillar 3: Analytics & Intelligence (P1)
- **Status:** Not started
- **Goal:** Unified dashboard + post/account metrics + weekly digest
- **First slice:** ingestion + normalized metrics schema + simple dashboard

### Pillar 4: Canvas Workspace (P2)
- **Status:** Partially related UI exists (workflow canvas), but PRDS card-based planning canvas is not built
- **Goal:** strategic planning canvas with cards/grids
- **First slice:** canvases + text/image/checklist cards + basic linking

## 3) Phase 1 (First Feature): AI Workflow End-to-End

### Objective
User can go from idea to generated output in one uninterrupted path:

1. Start new project
2. Build or prompt-generate a workflow
3. Run workflow successfully
4. See output node result
5. Save generated media + workflow
6. Reload workflow and run again with same behavior

### Definition of Done

- Happy-path workflow (Prompt + Generate + Output) works with Gemini using either env key or user key
- Image-input workflow (Image Input + Prompt + Generate + Output) works consistently
- Failure states are actionable (missing key, provider error, invalid connection, timeout)
- Save/reload preserves required state (workflow graph, key node outputs/references)
- Automated tests cover the full flow (API + store integration + UI flow smoke)
- CI passes with a fully green `pnpm test:run`

### Workstream Breakdown

#### WS1: Stability Baseline (Immediate)
- Fix current red tests:
  - Add missing `zod` dependency for chat tools
  - Fix/update welcome modal test selector mismatch
- Add a small CI gate policy: no merges on red tests

#### WS2: End-to-End Execution Reliability
- Validate and harden the core path:
  - `getConnectedInputs` correctness for image/text handoff
  - `executeWorkflow` and node status transitions (`idle/loading/complete/error`)
  - API error normalization from `/api/generate` and `/api/llm`
- Add explicit user-facing messages for top 5 failure modes:
  - Missing API key
  - Invalid provider/model config
  - Network timeout
  - Empty output from provider
  - Invalid workflow topology

#### WS3: Persistence & Reproducibility
- Validate save/hydration loop:
  - workflow JSON save/load
  - generation assets written and re-linked correctly
  - reopen project and rerun without manual repair
- Add regression tests for path/asset reference handling

#### WS4: Product UX for First-Time Success
- Tighten onboarding path:
  - clearer provider setup validation before first run
  - quickstart to runnable workflow with minimal edits
- Add in-app “Run Readiness” checks before execution

#### WS5: Test Coverage for the Feature
- Add/expand tests for:
  - Store integration: connected inputs + execution transitions + pause/abort
  - API routes: success + error contracts
  - UI smoke: create workflow -> run -> output visible -> save/load -> rerun

## 4) Suggested Sequence and Timeline

### Week 1 - Foundation Hardening
- WS1 complete
- Start WS2 error normalization and status consistency

### Week 2 - End-to-End Reliability
- Complete WS2 + WS3
- Add save/reload regressions

### Week 3 - UX + Ship Gate
- Complete WS4 + WS5
- Run full regression and release first “E2E workflow stable” milestone

## 5) Release Gate Checklist (Milestone: E2E Workflow Stable)

- [ ] `pnpm test:run` fully green
- [ ] New user can generate output in < 3 minutes from empty project
- [ ] Save/reload/rerun tested on at least 3 workflow shapes
- [ ] Failures produce actionable UI message (no silent failures)
- [ ] Internal dogfood sign-off from at least 2 test users

## 6) After Phase 1 (Next Milestones)

1. Pillar 1 expansion: brand kit, template depth, platform aspect-ratio bundles
2. Pillar 2 thin slice: account connect + schedule + publish worker
3. Shared foundation: auth/workspaces + PostgreSQL schema + background jobs


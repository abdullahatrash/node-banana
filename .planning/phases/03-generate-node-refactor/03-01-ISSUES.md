# UAT Issues: Phase 03 Plan 01

**Tested:** 2026-01-09
**Source:** .planning/phases/03-generate-node-refactor/03-01-SUMMARY.md
**Tester:** User via /gsd:verify-work

## Open Issues

### UAT-003: Gemini API errors (needs investigation)

**Discovered:** 2026-01-09
**Phase/Plan:** 03-01
**Severity:** Minor (possibly unrelated)
**Feature:** Image generation execution
**Description:** Gemini API request failed error when running workflow. May be unrelated to 03-01 changes (no API route changes made).
**Expected:** Generation works as before
**Actual:** "[api.error] Gemini API request failed"
**Repro:** Run a workflow with generate node

**Note:** This may be an API key issue or pre-existing problem. No changes were made to `/api/generate/route.ts` in this plan. Lower priority - recommend investigating separately or checking API key.

## Resolved Issues

### UAT-001: API response structure not handled correctly
**Resolved:** 2026-01-09 - Fixed in commit a2540f1
**Fix:** Changed `setExternalModels(models)` to `setExternalModels(data.models || [])`

### UAT-002: API keys not sent to /api/models endpoint
**Resolved:** 2026-01-09 - Fixed in commit a2540f1
**Fix:** Added headers with X-Replicate-Key and X-Fal-Key to fetch request

### UAT-004: Replicate shows incomplete model list
**Resolved:** 2026-01-09 - By design
**Note:** Replicate API returns paginated results (~25 per page). First page is sufficient for initial use. Full pagination can be added as enhancement.

### UAT-005: fal.ai shows video models in image-only dropdown
**Resolved:** 2026-01-09 - Fixed in commit f2895c3
**Fix:** Added capabilities filtering to /api/models endpoint. Models now filtered by ?capabilities param.

---

*Phase: 03-generate-node-refactor*
*Plan: 01*
*Tested: 2026-01-09*

---
phase: 05-orchestrator-metrics-projector-reports
plan: 05
subsystem: reports
tags: [report, html, self-contained, base64, xss-escaping, tdd, vitest, better-sqlite3]

# Dependency graph
requires:
  - phase: 05-04
    provides: metrics/tool_calls/iterations projection rows the report folds into the metrics table
  - phase: 05-03
    provides: expected.png screenshots role='expected' artifact the triptych regenerates from
  - phase: 01-03
    provides: openDb/appendEvent/readEvents + evaluations/artifacts/screenshots storage seam
  - phase: 01-04
    provides: writeArtifact/getArtifactPath (relative path resolved against resultsRoot)
provides:
  - "renderReport(db, runId, resultsRoot?) — pure fn returning one self-contained HTML post-mortem string (REPORT-02/CLI-02)"
  - tests/renderReport.test.ts — six verified case groups (self-containment, escaping, partial-run, section-order, caveat, backoff)
affects: [orchestrator, cli]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Self-contained HTML via template literals: data: URI images (readFileSync().toString('base64')), one inline <style>, native <details>/<summary> collapse — zero external refs, no JS (D5-09)"
    - "Single esc() choke point HTML-escapes (&,<,>,\",') every untrusted interpolated value (T-05-01 PRIMARY XSS mitigation)"
    - "Caveat + timeline share ONE readEvents(runId) read — the mockup_grounding_skipped probe rides the timeline's event log, no extra query, no metrics.mockup_injected row"

key-files:
  created:
    - src/reports/renderReport.ts
    - tests/renderReport.test.ts
  modified: []

key-decisions:
  - "Header names derived from the manifest (stack.template / versionStamp.modelId / scenario expected-path directory) because the Stack/Scenario specs carry NO `name` field — the planner's read_first assumption was inaccurate; the registry `name` columns are not populated by persistManifest so they are unavailable to a self-contained/testable report"
  - "Timeline copy toggle (Show/Hide agent timeline) done with a pure-CSS details[open] rule — keeps the collapse JS-free while honoring both UI-SPEC strings"
  - "Task 2 (GREEN) and Task 3 (REFACTOR: partial/failed empty-state, D5-01 caveat, D5-12 backoff) landed in one feat commit (5aa8ad5) rather than a separate 3rd commit — commit-granularity only, all Task-3 acceptance criteria met and green"

requirements-completed: [REPORT-02]

coverage:
  - id: SC1
    description: "Self-containment (D5-09): three data:image/png;base64 panels, exactly one inline style block, zero external refs (no <link>, no http(s)/relative src, no <script>, no fetch)"
    requirement: "REPORT-02"
    verification:
      - kind: unit
        ref: "tests/renderReport.test.ts#SELF-CONTAINMENT"
        status: pass
    human_judgment: false
  - id: SC2
    description: "T-05-01 escaping: narration script/onerror + run_id + tool argsSummary come back as escaped entities, never live markup"
    requirement: "REPORT-02"
    verification:
      - kind: unit
        ref: "tests/renderReport.test.ts#ESCAPING"
        status: pass
    human_judgment: false
  - id: SC3
    description: "D5-05 partial/failed: build_failed renders empty-state (No screenshot captured + failed-stage body), em-dash composite + no-composite note, FAILED · build pill, never an error screen"
    requirement: "REPORT-02"
    verification:
      - kind: unit
        ref: "tests/renderReport.test.ts#PARTIAL/FAILED"
        status: pass
    human_judgment: false
  - id: SC4
    description: "D5-04 section order: header < scorecard < screenshots < metrics < timeline (ascending indexOf of section anchors)"
    requirement: "REPORT-02"
    verification:
      - kind: unit
        ref: "tests/renderReport.test.ts#SECTION ORDER"
        status: pass
    human_judgment: false
  - id: SC5
    description: "D5-01 caveat fires iff a mockup_grounding_skipped unknown event is present in readEvents; D5-12 backoff note fires iff backoff_wait_ms>0 — verbatim UI-SPEC copy"
    requirement: "REPORT-02"
    verification:
      - kind: unit
        ref: "tests/renderReport.test.ts#CAVEAT"
        status: pass
      - kind: unit
        ref: "tests/renderReport.test.ts#BACKOFF"
        status: pass
    human_judgment: false

# Metrics
duration: 12min
completed: 2026-07-03
status: complete
---

# Phase 5 Plan 05: Self-Contained HTML Report Summary

**`renderReport(db, runId, resultsRoot?)` — a pure function that turns one stored benchmark run into a portable, self-contained HTML post-mortem (data: URI screenshots, one inline style block, native collapse, single XSS-escape choke point), proven by 6 vitest case groups.**

## Accomplishments
- Six UI-SPEC sections in mandated order: Header + status pill → mockup-grounding caveat (conditional) → Scorecard (composite + 4 sub-score bars) → Screenshot triptych → Folded metrics table (Performance / Engineering / Iteration / Tool-calls) → collapsible Agent timeline.
- D5-09 self-containment invariant enforced and tested: every screenshot is a `data:image/png;base64,` URI (read from disk via getArtifactPath → resolve against resultsRoot → readFileSync → base64), exactly one inline `<style>`, native `<details>/<summary>` collapse (no JS), zero external references.
- T-05-01 PRIMARY XSS mitigation: one `esc()` choke point escapes `& < > " '` on every untrusted interpolated value — agent narration, run_id, tool argsSummary, failed_stage, manifest-derived names.
- D5-05 partial/failed runs render as scored data points: null composite → em-dash + "No composite" note; absent generated screenshot → "No screenshot captured" empty-state naming the failed stage; never an error screen.
- D5-01 caveat and D5-12 backoff note are correctly conditional on the event log / metrics rows, with verbatim UI-SPEC copy. The caveat probe reuses the single `readEvents(runId)` read that feeds the timeline — no extra query, no `metrics.mockup_injected` row.

## Task Commits
1. **Task 1: RED — failing renderReport tests** — `aec0b25` (test)
2. **Task 2 (GREEN) + Task 3 (REFACTOR)** — `5aa8ad5` (feat)

## Files Created/Modified
- `src/reports/renderReport.ts` — the pure report renderer (esc() escaper, manifest-derived header, status pill, scorecard bars, base64 triptych with empty-states, grouped metrics table with backoff note, conditional caveat, seq-ordered narration + tool-call timeline; one inline style block per UI-SPEC palette/typography/spacing).
- `tests/renderReport.test.ts` — six case groups against a tmp DB + tmp resultsRoot, driving fixtures through public storage fns (persistManifest / updateRunComposite / updateRunOutcome / insertEvaluation / linkExpectedScreenshot / linkDiffScreenshot / writeArtifact / appendEvent) + direct metric/tool_call inserts.

## Decisions Made
- **Header names from the manifest, not a spec `name` field.** The Stack/Scenario zod specs have no `name` property (planner read_first assumption was inaccurate), and the registry `name` columns are not populated by `persistManifest`, so a self-contained/testable report must derive display names from the manifest snapshot: `stack.template`, `versionStamp.modelId` (falls back to `model.modelId`), and the scenario's `expected.path` parent directory.
- **Show/Hide timeline copy via a pure-CSS `details[open]` rule** — honors both UI-SPEC strings while keeping the collapse JS-free (self-containment invariant).

## Deviations from Plan
- **[Commit granularity] Task 2 (GREEN) + Task 3 (REFACTOR) landed in one feat commit (`5aa8ad5`).** The partial/failed empty-state, D5-01 caveat, and D5-12 backoff paths were implemented alongside the initial GREEN pass rather than as a separate third commit. No scope gap — every Task-3 acceptance criterion is met and green (see coverage SC3/SC5).
- **[Rule 1 — over-strict test assertion] Corrected one Task-1 escaping assertion.** The RED test asserted `not.toContain("onerror=alert")`; after escaping, the inert text `&lt;img src=x onerror=alert(2)&gt;` legitimately contains that literal substring but is not a live element. Replaced with `not.toMatch(/<img\b[^>]*onerror/i)` — the correct XSS check (no live img element). The escaper implementation was correct; only the test assertion was too strict. Fix committed with the GREEN implementation.

## Issues Encountered
None beyond the two deviations above.

## User Setup Required
None.

## Next Phase Readiness
- `renderReport(db, runId, resultsRoot?)` is ready for the orchestrator (05-06) and CLI (05-07) to call — the orchestrator appends the `mockup_grounding_skipped` unknown event (D5-14) that fires the caveat, and `report <id>` regenerates the HTML offline from the DB + artifacts alone.
- `npx vitest run tests/renderReport.test.ts` → 6/6 pass; `npm run typecheck` → clean.

## Self-Check: PASSED

- FOUND: src/reports/renderReport.ts
- FOUND: tests/renderReport.test.ts
- FOUND commit aec0b25 (RED), 5aa8ad5 (GREEN+REFACTOR)

---
*Phase: 05-orchestrator-metrics-projector-reports*
*Completed: 2026-07-03*

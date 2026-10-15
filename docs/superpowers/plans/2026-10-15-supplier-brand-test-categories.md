# Supplier Category Implementation Plan

**Goal:** Implement the user-approved category, PMO naming and internal maintenance-purpose change.
**Architecture:** Keep current HTML and CloudBase record flow; add maintenance_purpose to internal PM editing, strip it from supplier submissions, retain historical data.
**Tech Stack:** HTML/JS, Node.js, CloudBase, node:test and Playwright local fixtures.

- [x] Add backend tests for allowed maintenance purposes, partial updates, public input/output privacy and cross-brand manual grouping. Run tests before code.
- [x] Update supplier options, branded/legacy workflow buckets, automatic brand grouping, PM-only conditional fields, payload/dirty detection/export/import. Update official campaign choices from the live PMO evidence; retain stored old names.
- [x] Add backend normalization and public-field stripping. Run focused browser fixtures covering save/reload, category switching, old names, duplicate product names, all eight choices and narrow viewports. Run existing supplier and crowd regressions.
- [x] Review diff and syntax. Sync changed HTML to Workstream. Commit/push tencent-active. Deploy backend code and the two HTML files. Compare live hashes and read back actual UI without production mutations.

## Release verification — 2026-10-15

Implementation commit: `625defe`, pushed to `origin/tencent-active`. All 46 relevant API/browser tests passed. Both hosted HTML files and the downloaded deployed function source match the local source SHA-256. The function is Active/Available; the API returned 326 records with the same stable-field hash before and after deployment. Live browser checks confirmed all eight supplier options and the internal maintenance purpose choices. Historical record values were preserved.

CloudBase CLI 3.6.4 ignored the supplied function directory during an update invoked from the repository root, causing an UpdateFailed result for missing `scf_bootstrap`. Running `tcb fn code update supplierFeedbackApi -e louise-ai-d2gi63mlafa5599c4` from `cloudbase/functions/supplierFeedbackApi` resolved the issue. Function status and deployed source were checked after this successful update; CLI success text alone was not treated as verification.

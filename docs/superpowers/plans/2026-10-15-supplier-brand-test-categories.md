# Supplier Category Implementation Plan

**Goal:** Implement the user-approved category, PMO naming and internal maintenance-purpose change.
**Architecture:** Keep current HTML and CloudBase record flow; add maintenance_purpose to authenticated PM editing, strip it from supplier submissions, retain historical data.
**Tech Stack:** HTML/JS, Node.js, CloudBase, node:test and Playwright local fixtures.

- [x] Add backend tests for allowed maintenance purposes, partial updates, public input/output privacy and cross-brand manual grouping. Run tests before code.
- [x] Update supplier options, branded/legacy workflow buckets, automatic brand grouping, PM-only conditional fields, payload/dirty detection/export/import. Update official campaign choices from the live PMO evidence; retain stored old names.
- [x] Add backend normalization and public-field stripping. Run focused browser fixtures covering save/reload, category switching, old names, duplicate product names, all eight choices and narrow viewports. Run existing supplier and crowd regressions.
- [ ] Review diff and syntax. Sync changed HTML to Workstream. Commit/push tencent-active. Deploy backend code only then the two HTML files. Compare live hashes and read back actual UI without production mutations.

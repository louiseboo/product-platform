# Supplier test categories and PM-only intent

Approved by Louise on 2026-10-15: ship eight choices (Peet's / Ora × 档期测试、新品提案、老品维护、特殊测试) in the existing test_category field, synchronize inbox classification and editing, use live PMO campaign names, and add internal maintenance purpose 产品改进 / 产品复制.

- Supplier form exposes only the eight broad categories; campaign and maintenance purpose are PM fields. Public API ignores internal fields.
- Inbox workflow sections use the eight categories. Unbranded historic records retain their old values in clearly labelled legacy sections. Automatic product grouping must not merge different brands.
- PM panel shows campaign picker for campaign testing and a maintenance_purpose picker for maintenance. Switching categories preserves draft field values; saving, reload, CSV and Category Lab import preserve purpose. No purpose is guessed for existing records.
- Live PMO FY26/FY27 calendar verified in Chrome on 2026-10-15. Normalize only month padding and separators. FY26: 01 CNY, 02 情人节, 03 芝士分子周年庆, 04 创世巨星, 05 云南档期 1, 06 云南档期 2, 07 埃塞利姆古吉, 08 桂花档期 1, 09 桂花档期 2, 10 大航海家, 11 迪克森少校 1, 12 迪克森少校 2. FY27 uses the same names except 01 优胜美地 and 02 CNY. Old stored campaign names stay visible for PM review; no bulk rewrite or guessed month transfer.
- Deployment changes only supplier-submit.html, supplier-submissions-admin.html, and supplierFeedbackApi code. Keep cloud function configuration and other application files intact.
- Verify local save/reload, cross-brand grouping, legacy compatibility, mobile layout, public-field stripping, existing regression suites, deployed file hashes and live read-only UI. Do not create production sample records.

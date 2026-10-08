# Repair / mailroom / Source fixed contract review

Result: **PASS_SCOPE**. No P1/P2 found within the requested repair-consumer compatibility scope. This is a read-only fixed-source review, not a merge, deployment or operational acceptance receipt.

## Fixed versions and worktrees

- ERP peer: `daea6c337a52bf08e5950f587f1eacd2df8e3100`, compared with `745b8843d42e3955e740594f471b1283dc28d553`.
- ERP detached tree: `/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-erp-repair-review-mailroom-daea6c33-20261008`; origin `https://github.com/moztechCEE/ecom-accounting-system-.git`.
- Source peer: `13be4eac56616902b1b272440d1f37e823d1894f`, compared with `20f583b6284e93e5516a533733b3833120aaae0d`.
- Source detached tree: `/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/corely-aftersales-repair-review-mailroom-13be4eac-20261008`; origin `https://github.com/moztechCEE/moztech-after-sales-system.git`.
- Both HEADs and tracked/untracked clean state were read directly. The root agent separately verified named fetch, FETCH_HEAD and ls-remote; this reviewer did not repeat network operations.
- The repaired list helper used for the three-format compatibility experiment is fixed replay `3e7a6ce9` from the repair action worktree, carrying the previously reviewed `9b6e9ec3` feature.

## ERP findings

- `MailroomService.list` and `views` are byte-for-byte identical to 745. Independent AST method comparison finds only `itemSnapshot`, `create` and `command` changed; the other 16 existing methods are exact, including actor/canRead, Source read, detail/tasks, record/publish and capacity checks. No repair/workflow/document/integration service change was found in the compared scope.
- `itemSnapshot` only adds productId, barcode and storageLocationId. In `command`, the added receiptLinkChanges clears stale structured references around existing writes; it does not replace status changes, permission gates, task handling or financial/stock behavior.
- Receipt creation remains gated by the existing fresh actor, mailroom:create and company checks. It now intentionally requires bounded initial photos and matching Source version for REPAIR/RETURN, validates a selected active same-company product against name/SKU/barcode, and locks/resolves active same-company storage locations. Existing receipt idempotency and source capacity remain. This is a changed receipt-create input contract, not a claim that old clients without evidence/sourceVersion remain valid.
- productId/barcode/storageLocationId are nullable links. A source CaseItem identifier is not a Product identifier. No default product identity or permission is invented; a supplied actual product uses a composite `(productId, entityId)` foreign key to Product and an active/company validation. Existing rows are not backfilled by the two new migrations.
- Module registration adds Storage, Catalog and SourceMedia controllers/providers, leaving the existing providers and imports present. There is no RepairTodoService name or `/repair-workbench/todo` route in this peer, so the planned additive Todo provider/GET has no competing declaration here. Final integration still must retain both sets of registrations and the newer DOA read hotfix.

## Source and Todo consumer compatibility

- Source auth.ts, contract.ts, erp-integration.ts, confirmed-payment.ts, existing mailroom cases GET and direct-ID GET are byte-for-byte unchanged. `scope` and `sourceItems` have the same tokens; `receive()` has the exact original body.
- All existing toSource properties retain their expressions, including id/number/type/brand/version/status/statusLabel, repairAllowed, releaseInfo, contactName label, assignee fields and received/remaining quantities. The payment calculation is the same after ignoring formatting and trailing commas. The shared include only adds read-only shipment data.
- Direct ID and blank ordinary findMany calls retain the original scoped where/include/take/orderBy expressions. Direct ID still returns `{item: ...}`; ERP `sync.cases(entityId, '', id)` converts this into `items`, preserving the same authoritative identity/type/release contract. HMAC signs the configured company and exact path; origin, redirect:error and 8-second request bound stay intact. A Todo caller can use this existing contract, but this review does not certify the not-yet-fixed Todo implementation's own pre/post-await actor checks.
- New keyword search adds phone, customer, tracking and declared name/SKU matching with parameterized SQL, explicit client sourceChannels, no deleted cases, supported case types and open-status filters. The second ORM read re-applies the same scope. Product-detail fallback only applies when no current CaseItem exists. This does not turn a search keyword or source SKU into cross-company access or a physical product link.
- customerPhone is additive and nullable; ERP validates it at at most 100 characters. Added reverseShipments/inTransit are also validated and do not change releaseInfo or repairAllowed. Old snapshots without phone must remain null until an explicitly reviewed refresh/backfill mechanism supplies it; adding the field does not force an existing case's updatedAt/feed event.
- Source case attachments are CASE-level metadata/media, never an automatic native item photograph. The native repair-photo path continues to read only the item's evidence.

## Executed narrow evidence

- Independent AST/byte/token comparisons above were executed directly against the fixed Git objects. Source formatting-only differences were checked with a scanner that ignores trivia and trailing commas; no money or quantity expression changed.
- The real fixed receipt payload validator and fixed native repairPhoto helper were evaluated in memory for PNG, JPEG and WebP data URIs. Each accepted the same bounded native evidence and returned the exact original bytes/MIME. These are MIME/magic contract fixtures, not a full decoder or real camera test.
- Source 35-test, ERP media/proxy, receipt and schema/build results are author-provided evidence in the handoffs and were inspected as such. This reviewer did not rerun those suites, run Prisma generation/migrations, or operate a database, cloud service, GCS, payment, notification or inventory.

## Required final integration boundaries

- Apply/review the additive schema migrations and both independent module/controller additions in the DOA-owned integration sequence; protect newer DOA intake/read qualification code and the repair list read additions.
- Re-run the affected final integrated Todo/repair access tests against the final SHA, verify fresh actor/company/grants before and after upstream waits, and keep a failed or unavailable Source release state unknown rather than zero/ready.
- Central Claw generation/source hashes and real DEV API/Source compatibility remain separate release gates. The peer receipt, this scope PASS and a clean Git merge do not prove those gates or physical/human acceptance.
- No entire 54-file storage/receipt release acceptance, real-source credentials, real image decoding, production change or deployment success is asserted.

Reviewed at 2026-10-08T19:49:27+08:00

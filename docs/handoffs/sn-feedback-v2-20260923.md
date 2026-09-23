# SN staff feedback v2 — 2026-09-23

Source: Google Sheet `1Y-niNgfQWu1JyLbUev5mCC3grlLb0jIrS6_P-ZR_9_0`, tab `20260923-測試回饋v.2`, gid 1167790544, rows 3–9, including both linked Drive screenshots. Sheet not edited.

## Ownership and baseline
Isolated worktree `/Users/moztecheason/ecom-sn-feedback-v2-20260923`, branch `codex/sn-feedback-v2-20260923`, base f204b33d. Remote main a3791c48 / operations 2ec8282d unchanged at inspection. Other dirty worktrees preserved. No push/merge.
DEV baseline API 00003-2l2 / web 00005-zf8 each 100%; production serving API 00506-ray / web 00270-vob. WMS DEV independently advanced to corely-wms-dev-batch-16d7668-0923; no WMS changes. Shared files: product DTO/service, ProductsPage; remaining changes confined to SN module/UI/tests and DEV build script.

## Changes
- Read-only server preview uses same allocation rules/counters as activation, real upcoming carton IDs and per-carton serial list. No reservation; stale confirmation token rejects under allocation lock. UI refreshes on edits, focus/30 seconds and explicit refresh; activation retrieves a fresh confirmation range.
- NSI model code means non-serialized product. Hint added in coding and product profile. Activation creates only boxes and actual quantities, no serial rows/counters. Only no-SN carton PDF is offered; reprints select existing carton ordinals.
- Product create logs showed HTTP 409 conflicts; the only application 409 path was duplicate company SKU. Added specific Chinese duplicate message, edit/search UI, submit loading guard, barcode/model/serial-tracking update DTO fields and preservation of unrelated attributes. No SKU guessing or automatic conversion of internal SKU to barcode.
- Product SN profile includes editable international barcode. Server stores profile; choosing a product fetches current saved values. User clarified row 9 means reuse the last saved product profile, not WMS/warranty sync.
- Company-scoped draft deletion with revision check, row lock and audit snapshot; activated drafts cannot be deleted. Existing allocated serials/cartons never change.
- Independent manufacture-date range filter and visible manufacturing date in batch results; order-date filter remains.

## Validation
44 PostgreSQL integration assertions passed in disposable DEV schema, including concurrent allocations, stale preview rejection, activation/delete race, cross-company checks, NSI no counter use/carton reprint, product attribute preservation and manufacturing filters. 22 frontend tests passed. Backend/frontend builds and targeted SN ESLint passed. No migration needed.

## Release / pending
Initial DEV release completed from 53baac06, Cloud Build 8f8768d9-8888-4e65-8157-8b91f00f8a98: API 00004-nt4 / web 00006-rjs each 100%. Environment hashes unchanged; production/WMS traffic unchanged. 13 live API acceptance checks passed; fixture C136 retained (IDs in release evidence).
Browser TEST account successfully created `DEV-SNV2-UI-0923`, edited barcode to 04711299273085/color white/code W, then selected it in SN to verify persisted values. Existing draft C136 showed first/last 26/27, carton 004 and exact contents. Manufacture date 2027-01-01..31 excluded September results; clearing restored them. NSI batch shows 23 units/2 boxes and only no-SN carton export.
One small UI follow-up identified during acceptance: pause periodic preview refresh while the carton contents modal is open, so it does not close itself mid-read. Frontend-only follow-up deployed from 6042ad3d, Cloud Build 816a57f2-4bb1-4405-8e76-8e557746f160: web 00007-vnm receives 100%. API remains 00004-nt4 (53baac06). Physical printer/scanner and final warehouse/warranty import acceptance remain separate from this feedback fix. No external inventory/accounting writes.

## Final evidence
Live API fixture `C136` and browser product `DEV-SNV2-UI-0923` retained for review, exact IDs/checks in `sn-feedback-v2-release-20260923.json`. Live no-SN tail-carton PDF: 1 vector page, 60×45 mm, zero raster images; decoded international barcode and original carton ID. Physical print remains unverified. No production or WMS release, no merge/push. Disposable DB test schemas cleaned.

Final browser check: carton contents remained visible beyond the 30-second polling interval and closed successfully through its Close button. DEV serving revision readback confirmed API 00004-nt4 and web 00007-vnm, 100% each.

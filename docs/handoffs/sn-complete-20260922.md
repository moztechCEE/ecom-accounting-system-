# SN feedback implementation — 2026-09-22

## Scope and ownership
User requested all unfinished items from `序號(貼紙)生成系統-回饋`, tab `20260922-測試回饋v.1`, rows 3–16. Original Word read including all four embedded example images. Latest user rules take precedence: reversed manufacture-year suffix, independent model/style/color/year counters, optional style code, same-day grouping, fixed cartons, reprint existing SN, additional production gets new numbers; warranty SKU = international barcode.

Worktree `/Users/moztecheason/ecom-sn-complete-20260922`, branch `codex/sn-complete-20260922`, base `fe4c4e1a`. ERP origin main `a3791c48`, operations `2ec8282d`. Other dirty warehouse/UI and original worktrees preserved. No push, merge or production release. Shared files: backend AppModule, ProductController/Service, manifests, frontend ProductsPage/product.service; SN page/model/designer. Existing WMS direct-entry code retained.

## Implemented
- Server-saved, company-scoped drafts with optimistic revision checks and explicit import of browser drafts (local copies retained).
- Product SN profile stored in `products.attributes.snLabels`. Dedicated patch preserves unrelated attributes and updates model number. Product create supports profile fields; corrected product type choices to match existing backend enum and removed unsupported create fields.
- Transactional activation, global advisory lock, unique printable prefixes and SN primary key, persistent sequence counter and immutable source drafts. Retrying an activated source returns its existing batch. Different tuple boundaries cannot share one printable prefix.
- Same company/product/scope/order date merge into a batch. Appending requires matching manufacture date, capacity and template. Previous partial cartons remain fixed; additions get subsequent carton numbers and preserve source linkage.
- Box numbering `CTN-YYMMDD-MODEL-001`, actual tail quantity and explicit per-SN carton position. No arbitrary repack or skip-number command.
- PDFKit vector PDF: product labels 28×7.5 mm default (editable); cartons 60×75 mm; no-SN cartons 60×45 mm; proportional carton scaling. Embedded Noto Sans Traditional Chinese font with OFL license. QR uses 4-module quiet zone; UI size field measures symbol body and separately states full width. Font input pt converts to stored mm so old drafts retain size.
- PDF printability checked before allocation; overlapping/overflowing text or QR density rejects without consuming numbers.
- Warranty XLSX exact headers `一般序號`, `SKU`, string cells preserve barcode zeroes. Configurable generic warehouse SN XLSX includes barcode, carton, position and source dates. Export range and reason logged; outputs never allocate more SN or mutate stock.
- Search/filter by product/name/model/barcode, status and order-date range; order-date sorting; allocation and export history.

## Validation
- PostgreSQL integration suite: 25 checks passed in disposable `sn_acceptance_*` schema within DEV database. Includes concurrent retry, concurrent append, prefix collision, overflow, cross-company rejection, fixed tail cartons, rollback and reprint selection.
- Frontend focused suite: 21 tests passed including SN rules and existing WMS navigation.
- Backend and frontend builds passed.
- Three PDFs rendered and visually inspected; embedded Chinese glyphs and layout clear. Product 3 pages at 28×7.5 mm, carton 1 page at 60×75 mm, no-SN carton 1 page at 60×45 mm. Page image count zero (vector content). ZXing decoded product SN, international barcode, carton ID and complete dot-separated carton SN list.
- Warranty XLSX readback verified header, string cell type and leading zero; warehouse readback verified exact carton relation.

## Unconfirmed / acceptance boundaries
- User asked which warehouse format to target; response pending. Current WMS order importer requires shipping/order identity, not just production SN stock rows, and accepts 12/13-char SN while spec allows 12–14. Do not label generic XLSX as accepted by that importer. No speculative order identifiers or writes to WMS/ECOUNT/stock.
- Physical printer/paper/scan-gun acceptance and actual warranty-system import remain user/receiving-system checks. Automated PDF decode is not physical factory acceptance.
- Single activation/export range limited to 10,000 SN; carton capacity ≤100 to bound QR payload. Larger jobs use additions/export ranges. Large template data that cannot fit are rejected before allocation.
- Existing font/label snapshots remain fixed after activation. Use design preview before activation; failed printability never reserves serials.
- No shipping command, stock deduction, production allocation or account permission change in this release.

## Release
DEV release completed. Cloud Build `c5848985-beb8-461a-a406-981d4fcd30a0`, source `ba9b7cdc`. Web `corely-erp-dev-00005-zf8` and API `corely-erp-api-dev-00003-2l2` both receive 100% traffic. Migration `20260922000000_sn_labels` applied and recorded in DEV only. Baseline web `corely-erp-dev-00004-lc7`, API `corely-erp-api-dev-00002-d4n`. New migration adds only SN tables; execute exactly this migration in DEV, not all historical migrations. Runtime images retain existing sandbox, secret references, database and WMS portal env. Build script uses locked extra QR/barcode dependencies; standard backend Dockerfile also includes fonts for future full builds.


## Live release acceptance
- Existing admin API login and existing TEST browser login both succeeded without credential or role changes.
- Real DEV API: created labeled QA product `DEV SN 功能驗收 B39A`; SN profile patch retained unrelated attributes; 43 units allocated as 20/20/3, replay did not allocate again, +2 merged into same batch leaving old tail fixed. All five exports returned files. Exporting 41–43 did not advance last sequence 45. Search and output audit passed.
- Live output PDFs were rendered; ZXing decoded the actual 14-character product SN and the complete tail carton list. Warranty and warehouse outputs are retained outside Git in `/tmp/corely-sn-live-acceptance` for this session's QA.
- Browser: searched B39A, opened persisted batch, expanded exact tail contents 41/42/43. New draft product selection automatically filled model, color, model/color codes and left optional style blank. Font field displayed pt and QR control stated body versus full margin size. Saved an additional clearly labeled UI fixture draft on the server, then confirmed activation from the actual UI: it merged into the same batch and allocated exactly SN 46 in carton 005. The displayed total is now 46 SN / 5 cartons; original cartons were retained.
- Mac/browser initially unavailable; browser access recovered later. No browser storage/token injection or credential reset was used.
- An interrupted Cloud SQL proxy connection left one empty disposable acceptance schema; it was removed explicitly. Subsequent acceptance passed and schema inventory was empty.
- Release readback in `sn-complete-release-20260922.json`; original production ERP and WMS revisions unchanged. No push/merge; coordinate exact commits before integration with another Codex.

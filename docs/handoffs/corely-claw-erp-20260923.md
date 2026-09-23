# ERP Corely Claw port — DEV first

User requested the same small Copilot concept and capabilities as the AI customer-service system, with complete ERP operating knowledge. Existing ERP real AI and authenticated live reads must remain available. All releases go to DEV for user acceptance before production.

## Verified reference and ownership

- Customer-service reference: clean `/Users/moztecheason/Documents/ChatGPT/AI 客服系統/corely-applicability-20260915`, `4dd0d938b86ee51106fbf7b929d4c6a383f355bd` (remote confirmed). Its code equals deployed DEV `dd2a9e845293ecf40381a95ec4f3b0e1977b185d`; subsequent differences are documentation only.
- Actual Claw files: `apps/ops-ui/src/components/claw/{CorelyClaw,ClawMascot,ClawPanel}.tsx`, `knowledge.ts`, `scope.ts`, styles and source manifest; page help uses `components/ops/SetupHelp.tsx`.
- Current Claw is an authored, role-filtered document browser/search panel. It has no LLM, persistent conversation, streaming, business writes or tool executor. The customer-response Agent Runtime is a different subsystem. This port retains ERP's real AI instead of confusing those two products.
- No customer-service source, credentials, runtime or traffic is modified. The old dirty `/Users/moztecheason/service-orchestrator-2` checkout is protected.
- ERP isolated worktree: `/Users/moztecheason/ecom-erp-corely-claw-20260923`, `codex/erp-corely-claw-20260923`. Base `9165c712` plus latest documentation `53188aab`, including expense/cashier fix `637518d0` and deployed WMS entry/audit source `fa04a2bd`.
- Cloud baseline: `corely-erp-api-dev-entry-audit-0923` and `corely-erp-dev-entry-audit-0923`, each 100% DEV. Immutable digests are pinned in the release helpers. Existing WMS portal, sandbox, AI opt-in, secrets and all other service configuration are preserved.

## Intended parity and knowledge boundaries

Same mascot and compact guide experience, full/search/category/article views, current-page help, bilingual guides, synthetic examples, source versions/hashes, identity/permission/company scope reset, accessible keyboard/mobile behavior. ERP operating guides are grounded in reviewed ERP routes and source files; customer-support policies are not copied into accounting guidance.

ERP AI consumes authorized full guide sections and provides existing authorized live read tools. A guide is not a live business query; an expense application is not an accounting posting; payment registration is not a bank transfer; WMS live operational data is separate from ERP stock snapshots. No new business-write executor, approval bypass, persistent conversation or streaming is represented as already existing in Claw.

## Release procedure

`build-corely-claw-release.py` requires a clean checkout retaining the current DEV baseline, unchanged dependencies/startup/assets, fresh source compilation, immutable images, and unchanged cloud state. It builds only ERP DEV images.

`deploy-corely-claw-release.py` preserves service configuration and existing tags, adds candidate-specific CORS origins, verifies protected ERP production and WMS state, creates zero-traffic candidates, then prepares the stable-API web revision and promotes only after functional acceptance. No migration or IAM change is required for this port. Rollback is the pinned entry-audit revisions, subject to a fresh check for later DEV releases.

## Validation and release receipt

Local implementation: 55 bilingual guides across 9 module groups, covering 64 route/filter entries and 78 reviewed source hashes. The source drift/coverage check runs in the release build and quality-gate workflow. Historic 24 guide identities are retained; outdated dashboard and reimbursement text was corrected against current pages.

Local validation: backend 60 suites / 384 tests passed; focused AI/receipt 4 suites / 86 tests passed; frontend production compilation and 19 existing access/navigation/WMS tests passed. Claw UI logic/safety tests 10/10, model preference tests 6/6, generated-catalog negative checks 9/9 and DEV sandbox tests 9/9 also passed. Provider-error messages in the unit log are deliberate mocked failure tests.

That local source checkpoint was followed by the candidate reviews below. Final DEV release status and its remaining provider limitation are recorded at the end; no production acceptance is implied.

## Initial zero-traffic candidate review

Source `ff5e636e`, build `0057f053-c270-45b4-94a7-c639a4595344`, passed HTTP knowledge/ACL checks and the browser guide/mobile/download checks recorded in artifacts. The first HTTP harness incorrectly expected 200 instead of Nest's valid POST 201; the harness was corrected and its failed receipt retained. Manual review of the real model answer then found a substantive finance explanation error: it combined cashier bank transfer with separate accounting posting. That answer is preserved as rejected evidence. The guides and composition instructions now explicitly separate approval, external bank transfer, ERP payment registration and accounting posting. An additional browser finding aligned dashboard guide access with the actual non-warehouse-only menu, without changing live data authorization. A corrected candidate must pass real model review before traffic promotion.

## Model compatibility found during candidate acceptance

The `a861a006` zero-traffic candidate passed the corrected finance-answer semantic review (root plus independent reviewer) and all 19 knowledge/ACL/source checks. Browser page help confirmed the employee dashboard article and corrected expense stages. Its existing standard provider intermittently returned HTTP 429, while the existing deep model returned HTTP 404; these are retained as failed acceptance receipts, not counted as successful real-time queries. No traffic was promoted from either earlier candidate.

Using only the existing DEV provider credential and a synthetic JSON readiness prompt, `gemini-3.5-flash-lite` and `gemini-3.5-flash` each returned 200 with the expected JSON. `gemini-3.8-flash` returned 503 twice and was not selected. The [official Flash-Lite model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite) and [Flash model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash) document these as stable models with text, image and PDF input support. No credential, prompt containing business data, or provider thought signature is stored in the receipt.

The compatibility correction keeps standard/deep preferences, maps legacy model IDs, and adds only the two exact provider paths to the existing DEV network allowlist. No new provider, billing setting or wider network access is introduced. Full ERP guide and live SELF queries must be rechecked on the resulting candidate; direct provider readiness alone is not acceptance.


## Final DEV release — 2026-09-23 22:01 Asia/Taipei

- Runtime source: `d366985f8c02afd11d01c60e0fd927885611b7f2`, pushed to `codex/erp-corely-claw-20260923`.
- Cloud Build: `814bc342-b782-40d0-a1ac-f82f200dca07`, SUCCESS.
- API: `corely-erp-api-dev-claw-d366985f-c`, 100% DEV; image digest `sha256:715b499020285794ca69336b9930a1c1692817d9c3e855ff7b8b58a87ec8f9c3`.
- Web: `corely-erp-dev-claw-d366985f-f`, 100% DEV; image digest `sha256:da98334697d2f1057eb3131202d58cd022c423bb2b8920d35fba5ab0ae965b8d`.
- Stable URL: https://corely-erp-dev-sp5g377smq-de.a.run.app ; web uses the stable DEV API URL, not a candidate API URL.
- Library version: `erp-claw-6fe41131897b80f4`; reviewed source version `sha256:0838d8a5b84f6dc585a1d2b770603b87de987405862efe637e827a6015000198`.
- No migrations or IAM changes. ERP production and WMS production/DEV cloud configuration and traffic remained unchanged. Customer-service system was never modified.

Accepted evidence in `artifacts/corely-claw-erp/dev-20260923/`:

- `candidate-api.json`: 24 checks passed, including actual standard-model guide answer and live SELF expense query, plus manual semantics review. Browser independently returned the same own-expense result with date and source scope.
- `stable-api.json`: 19 authenticated knowledge/ACL/source checks passed after API promotion.
- Both `ocr-gemini-3.5-*.json`: synthetic image recognized as TWD 1200 dated 2026-09-23 with matching fingerprint and human confirmation still required. No expense application or payment was created.
- `browser-final.json`, `candidate-guide-final.png`, `candidate-ai-final.png`: final UI and authenticated stable DEV acceptance. An additional stable tab preserves the user's original settings form and signed-in session; Claw home is open for review. Earlier unchanged UI checks include 320x740 layout, focus wrap/Escape, bilingual articles, allowed categories and a verified synthetic download.
- `qa-cleanup.json`: four QA identities/company fixtures disabled, two exact zero-assignment temporary roles removed, no active QA WMS session or created business expense, and passwords removed from the private manifest. Task-owned SQL proxy stopped and candidate tabs closed.
- `release-receipt.json`: sanitized images, revisions, traffic and rollback pointers. Only receipt/documentation changes follow this runtime commit.

Remaining limitation: the deep model (`gemini-3.5-flash`) passed direct readiness and image OCR, but text Copilot returned provider HTTP 503 on two bounded attempts. These failures remain in `candidate-deep-provider-503.json` and `candidate-deep-api.json`; deep text chat is **not accepted**. The default standard model (`gemini-3.5-flash-lite`) passed actual guide, live query and browser checks. No automatic provider switching or concealed retry success is claimed. Legacy report/AI item-generation paths that bypass AiService were not migrated by this Copilot port. Physical mobile keyboard behavior and production acceptance remain outside this DEV acceptance.

Rollback pointers: API `corely-erp-api-dev-entry-audit-0923`, web `corely-erp-dev-entry-audit-0923`. First recheck current DEV ownership/revisions to avoid undoing a newer release. This is a traffic rollback only; it does not authorize database changes or any production action.

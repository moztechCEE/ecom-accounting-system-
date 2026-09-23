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

Local validation: backend 60 suites / 368 tests passed; focused AI 3 suites / 61 tests passed; frontend production compilation and 19 existing access/navigation/WMS tests passed. Claw UI logic/safety tests 10/10, generated-catalog negative checks 9/9 and DEV sandbox tests 9/9 also passed. Provider-error messages in the unit log are deliberate mocked failure tests.

DEV candidate and live-browser acceptance are still pending at this source checkpoint. No production acceptance is implied. Final source SHA, DEV images/revisions, browser evidence, QA cleanup and remaining limits will be appended after verification.

## Initial zero-traffic candidate review

Source `ff5e636e`, build `0057f053-c270-45b4-94a7-c639a4595344`, passed HTTP knowledge/ACL checks and the browser guide/mobile/download checks recorded in artifacts. The first HTTP harness incorrectly expected 200 instead of Nest's valid POST 201; the harness was corrected and its failed receipt retained. Manual review of the real model answer then found a substantive finance explanation error: it combined cashier bank transfer with separate accounting posting. That answer is preserved as rejected evidence. The guides and composition instructions now explicitly separate approval, external bank transfer, ERP payment registration and accounting posting. An additional browser finding aligned dashboard guide access with the actual non-warehouse-only menu, without changing live data authorization. A corrected candidate must pass real model review before traffic promotion.

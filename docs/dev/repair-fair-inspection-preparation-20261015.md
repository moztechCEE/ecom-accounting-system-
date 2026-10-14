# Fair inspection preparation

This commit prepares the technician form, typed assessment/review records, pure validation and isolated component tests. It is **not a deployable full workflow**: the existing save DTO/service, CSR action, release/publication guards and Source proof gates are not wired. Central DOA explicitly holds those shared paths for a paired batch; do not deploy this UI against the old write contract.

Base: `aa7ce96196a14eccf225aeade5c453ef5cb3cbbf`, branch `codex/repair-fair-inspection-20261015`. DEV subsequently advanced to ERP `5f7dd8468881678828601312a908e8d9ca053aee` and Source `e050e5edcdb6b8648f9378381cb763ff7ac683f8`; Root fetched the exact ERP GitHub object and confirmed the repair/mailroom/schema/sandbox production paths are unchanged from the base. No deployment, database, real provider, finance or inventory action occurred in this preparation.

## Prepared behavior

- Existing three workbench entrances remain. The inspection form uses 收件核對／重現問題／核心檢查／判斷與佐證; the existing repair document contains 修復與複驗. No new page tab or explanatory banner.
- New forms default to UNDETERMINED. Explicit PRODUCT_FAULT and USER_CAUSED require an observed check, basis and causal explanation. Unknown remains unknown; an old false flag is retained as a historical fact and never converted into a product-fault conclusion.
- Ordinary empty unknown records hide extra evidence selectors. Stored unknown drafts retain their selected evidence. Model-specific checks use the existing reviewed company/Product/SKU/version/hash template, without invented manufacturer thresholds.
- New serialized inspection data includes `assessment={schema:1,conclusion,basis,causalExplanation,checkKeys,mediaIds}`. USER_CAUSED maps to true, PRODUCT_FAULT to false, unknown omits the compatibility boolean. Diagnosis is the single causal input.
- The pure contract validates exact draft shape while allowing unfinished drafts. Submitted confirmed findings require proper causal evidence; AFTER-only media and arbitrary OBSERVATION measurements cannot establish human damage. The existing server registry and finalized-media authority must still be wired and verified.
- The pure review contract requires a current revision/hash and a different same-company authorized active reviewer, including employee aliases. The UI only reads a canonical current proof and does not generate it.

## Executed scope

Child final pure assessment suite: **81/81 PASS**, scoped lint exit0, Node24. Earlier60 execution is retained as history, not added to the final count. Child real headless Chrome component suite: **13/13 PASS**, no skipped tests, scoped lint exit0, Node24. Root whole frontend and backend builds: exit0, explicitly Node22. Root actual CUA preview rendered BONSON unknown desktop and Moztech human mobile; width390/documentWidth382, viewport restored. These use synthetic component fixtures, not hardware specifications or live DEV business acceptance.

Detailed logs, byte hashes and prior failures are preserved outside the product repo under `plans/workbench-coordination/evidence/repair-fair-inspection-20261015/` in the parent coordination workspace. The untracked service TDD is pending shared implementation and has not run; it is intentionally excluded from this preparation commit.

## Required paired integration

New save operations, including drafts, must require assessment and get a server-only workflow policy stamp tied to document revision/hash. Keep transport compatible with old exact request-ID/body retries: validate trusted persisted replay before enforcing new-operation mandatory fields. Historical document readers and previously submitted records remain unchanged. Prove legacy continuation from actual immutable submission history and the original Source proposal/current binding; never use absence/date/protocol as a downgrade.

`review_assessment` is a claimed-CSR action independent of customer consent/payment/invoice. APPROVE keeps WAITING_CUSTOMER and CSR ACCEPTED; DECLINE records REVISE and returns to the original technician. It cannot stand in for `resolve_customer`, which already requires Source customer consent. New inspection revisions clear current proof and preserve history.

Keep the true technician proposal producer. Central must choose and implement the paired Source authority: independent signed current review event/ledger, or bounded fresh signed ERP inspection proof. Cover actual adopt, notification create/approve/send/retry and AI dispatch-proof entrypoints. Public inspection/repair reports also need current positive-review guards on publication and existing token access, because a review-only change does not alter document datahash. Do not add private evidence to the customer AI wire.

Existing customer consent, actual confirmed funds, required issued invoice, materials, reviewed checks/calibration, controlled workStart, personal custody, QC and mailroom acceptance remain separate gates. Claw guides/source hashes and final paired SHAs require central review before release.

## Original DEV case

The original case remains inspection rev1/native v7, Source quote2/TWD1 and QUOTE_READY `c168eff0-9228-4ab3-abc3-a67a36a50d15` DRAFT. AI receiver authorization fixes and isolated mock-LINE delivery are pending central owners; customer consent, repair payment/invoice, repair/QC/report and mailroom accept_return have not passed. This preparation neither backfills that document nor claims the original end-to-end flow completed.

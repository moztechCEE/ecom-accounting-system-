# c932 final code/knowledge addendum — 2026-10-08

Conclusion: **PASS_SCOPED_CONTENT_BINDING_AND_LOCAL_DOM**. This is additive to the earlier e4 HOLD report; that report and all historical failures are preserved. This conclusion does not grant new release-helper approval, candidate acceptance, promotion or live business acceptance.

Review HEAD start and end: `c932d30f2d9ce8453f9910d257920d5465145c4e`. Parent-owned catalog/generated/manifest remained uncommitted while reviewed. Their reviewedBase is the same c932 code base. All **208** curated production source hashes and two exercised fixture hashes were captured before the new test and remained unchanged afterward; knowledge bytes were also unchanged during this interval.

## Bilingual and generated binding

The final six affected entries remain dashboard, mailroom-workbench, repair-workbench, after-sales-customer-workbench, after-sales-native-cases and after-sales-native-invoices. The accepted precision correction now explicitly scopes the REPAIR restriction to the `sourceCases` awaiting-arrival source list, preserving native RETURN refurbishment read eligibility. The Chinese and English statements agree with `mailroom.service.ts`'s separate source-list filtering and native-item eligibility. Existing mailroom read does not require intake CSR eligibility; full CSR source-list access still requires its fresh qualified actor/company gate. No new grant is introduced.

The reviewed low-distraction layout, six source type identities, saved document versions, concrete personal custody/acceptance, old synchronization history and pending dispatch consumer retain the boundaries stated in the earlier report. Brand LINE/AI identity/conversation/assignee binding, independent invoice merchants, virtual-account reconciliation and actual customer notification/payment are explicitly still outside this UI batch's completion claim. No new P1/P2 semantic or bilingual mismatch was found in this final scope.

Independently executed `node scripts/dev/generate-copilot-knowledge.cjs --check`: **PASS 79 bilingual entries / 12 groups / 103 routes / 208 sources**, retaining the original 24 entries. Independently recomputed every source hash, sourcePath closure, sourceVersion digest and generated entry content/source reference binding. All match. The deleted `MailroomNextStep.tsx` remains absent.

| Artifact | SHA256 |
| --- | --- |
| catalog.source.json | `16cd0473f643f6ec4c8fa2fdb22703640082ace974bb35e0751d8cfe28335170` |
| catalog.generated.ts | `ae085644c56c48534f6c6d5edbacc463266fddec6cc39f16698b656438411cad` |
| source-manifest.json | `b9390c2af27f01608054b043b83bd7abcbb76d85a7a14cdaf505848f5a04df89` |

Final sourceVersion: `sha256:581dc117c5ed2bc3b8a63ac2890a44679971b14a30b270f75833d7c4106ffaa3`.

## Actual React DOM evidence

`workspace-company-dom.test.mjs` was freshly executed at c932 because the mailroom refresh owner changed. Result: **9/9 PASS**, failures/skips 0, **16.20 s**. The actual DashboardPage/Layout, native Mailroom/Repair pages, hub, company hook, router and permission components use controlled synthetic external boundaries. It covers company/query snapshot isolation, late-response exclusion, explicit company preservation, workspace navigation, the six desktop/mobile service controls, help/title and blocked-view feedback.

The specific pending-load concurrency P2 has a separate parent/source-audit actual counterfactual and Awaiting DOM report. This workspace suite is not presented as that direct red→green regression. The only reviewed production delta from e4 in the frontend is the mailroom refresh's `setMoreBusy(false)` ownership reset plus its specific test.

Previous Module suite result **8/8 PASS** is inherited solely because its actual tested ModulePage/Hub/workbench-model/navigation/feedback/test bytes remain identical from f8 through c932. It was **not rerun** and is not relabeled as a new c932 browser execution. The synthetic native draft and iframe harness tests six routing controls, dedicated finance grants, forbidden scope, overview launch/close/reopen, cancellation retaining drafts and authorized intake deep-link discard.

| Evidence | Path | SHA256 |
| --- | --- | --- |
| Fresh workspace DOM | `/private/tmp/corely-doa-cleanup-release-20261008/workspace-company-c932.tap.log` | `e1c852c3ed51b7ccc17c99a743c160242818c7f937fa41af199a7c8f00c4e605` |
| Generator check | `/private/tmp/corely-doa-cleanup-release-20261008/knowledge-c932-check.log` | `8e81e941d419c141f49e6159d4c90c230c36646b5a017f738bc885748e1ade04` |
| Before-test source capture | `/private/tmp/corely-doa-cleanup-release-20261008/c932-source-baseline.json` | `2fc86d76bcb873ba82d66ba0443aac7d9fd243e9d5273ce130004ee8e9e2a1a2` |
| Scoped final readonly proof | `/private/tmp/corely-doa-cleanup-release-20261008/knowledge-c932-final-readonly.json` | `483aedd22b35d7061c84dfb40c6ccd22e48f357ccbcd0dca4dd2d14532572a41` |
| Historical Module DOM | `/private/tmp/corely-doa-cleanup-release-20261008/after-sales-module.tap.log` | `60db3c415c5264121f2b7d09a832e467d5f47245a9997fb2c1cac2251786b0af` |

Affected current files:

| Path | SHA256 |
| --- | --- |
| `frontend/src/pages/mailroom/MailroomPage.tsx` | `1d568fcdc3cdb4f88b276bd804932568542ea2d4a478d835cc9f31d347177e49` |
| `frontend/src/pages/AfterSalesModulePage.tsx` | `8c911cbe6da50b4847b5e71b5b1c3d513c8ecfc3a51740dfee173d634057be4b` |
| `frontend/src/pages/after-sales/AfterSalesWorkbenchHub.tsx` | `0e8362f5d2f506fd767288bdcb7fd113ec1cdc16cedca58b02dc1be323ef5dd0` |
| `frontend/src/pages/after-sales/workbench-model.ts` | `8c9beaef2a4e085ee1d00d28874eef76a955cf26934800a6199f98e4b1535aab` |
| `frontend/src/pages/repair/repair-navigation.ts` | `46d5cec64b064ba9b496bbf0cdfc2068e3b741a0a0b9107700bc87091b348072` |
| `frontend/src/pages/repair/repair-feedback.tsx` | `9e0742ef0ed4c7ced24846e67c7f60c91306ba215ed58b01342c3a7e17d0bb14` |
| `frontend/tests/workspace-company-dom.test.mjs` | `00c27d7cef9b477c1c801775100ee19d0f95db93b57afa1ea83c0e3411da787c` |
| `frontend/tests/after-sales-module-dom.test.ts` | `1a9a30ba60dc3a3014c08b6cbcae7e7a2c63a29aff57d4f1ccfebd57fba02674` |

Product/tests/catalog/generated/Root release tooling and history were **not modified** by this work. This addendum and private readonly test artifacts are the only new outputs. External business API/DB/cloud/provider/notification actions: **0**. These local results do not prove real EASON mapping, Source original button execution, physical custody, finance, LINE or a deployed candidate. New operator SHA/build/context pins remain separate prepare-only gates.

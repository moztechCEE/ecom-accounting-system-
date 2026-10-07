# Cleanup DEV release — independent recorded-evidence review, 2026-10-08

Conclusion: **PASS_SCOPED_DEV_RELEASE_EVIDENCE**. All five saved phase records, both distinct ordinary-role UI runs and the Parent's final sanitized stable observation are internally consistent and bound to the approved build. No new P1/P2 was found in this release-evidence scope. This review did not perform login, browser actions, cloud reads/mutations, business calls or product edits; it independently read and checked the actual preserved artifacts. It is not an attestation of external/physical business completion.

## Fixed source, build and runtime

- Deployed ERP source: `6cc903951d42d3f0e9aa5556598595397734859b`.
- Actual ERP Cloud Build: `3d399ff2-4542-4f0e-8ef7-ad3cae897b50`.
- Build context manifest SHA256: `9f394ca4ac14821f00313682af986b2dc50f52a21b6fec6827b0aa59efcbb88d`.
- API digest: `sha256:ac30e3f11f3081c8fb12f241304a30851e893c97be9c65c5ab47b64fe356e968`.
- Web digest: `sha256:51084ac135312f7fe90da3efec442df3d002996915f377906039f5d024f1be4a`.
- Source stays `20f583b6284e93e5516a533733b3833120aaae0d`, build `cdc6dd0a-d2ad-42b4-bac9-022dc8f55f82`; original Source20f-F and embedded module20f-S are unchanged.

Final saved traffic and Parent's subsequent stable observation both show **API `corely-erp-api-dev-doa-6cc903951d42-c` at 100%** and **Web `corely-erp-dev-doa-6cc903951d42-f` at 100%**. The approved API candidate revision is promoted directly; this review does not invent a new API-F revision.

The operator remains `a949203af3f34bc2be28f3c9adb449f25aeb6f624f4557e85c699bfa9dfc9741`, verifier `ff27796792140afb88ef764376115cd272296803cf3500897f7460661159b6d2`, composer `8bf6a522afbb44827076855bc26fafcbe4dbf87965c6b7901f613b89701a134e`. Earlier independent pin review verified only the three approved literal changes and 65/65 offline guards. The old 264 release's operator `4ce411fa6562da9760a500fb13300ef95916ed20406968981b711b56aa3aaf5e` and state `796374a789dc22a5199e4a54d780bb2d61c3a310017a591d9d6aa1d66fd9e5c1` remain exact first-three-phase historical evidence; no old receipt is relabeled current.

## Five recorded phases

All times below are UTC. Each per-phase receipt equals its state completion row; phase order and timestamps are monotonic. Every planned revision, immutable image and observed active traffic matches the phase. Every spec preserves all unrelated tags and runtime configuration, except its reviewed image/name/owned-tag changes and Web's explicitly scoped API_URL/WS_URL transport. The serving f3 rows stayed unchanged until their explicit promotion phase.

| Phase | Actual recorded revision | Observed at | Receipt SHA256 |
| --- | --- | --- | --- |
| candidate-api | `corely-erp-api-dev-doa-6cc903951d42-c` | `2026-10-07T23:29:45.734215+00:00` | `2b978b93a40a86fbbb75620b14f46c979b3565c25cc0b3a382d079150341a463` |
| candidate-web | `corely-erp-dev-doa-6cc903951d42-c` | `2026-10-07T23:30:49.558111+00:00` | `44c954a6e5e783fbccb5ae37f67cd9bd458f86a84bdec16f4a16f4f3a3ec6e09` |
| final-web | `corely-erp-dev-doa-6cc903951d42-f` | `2026-10-07T23:31:30.379195+00:00` | `e9ca0701766c7e937d8a741c1f1f95b0f1a41d9111bd2ab2d80847bd1e7ee215` |
| promote-api | `corely-erp-api-dev-doa-6cc903951d42-c` | `2026-10-07T23:33:19.730580+00:00` | `18496e736a8fcc00d5dddc51360864aa3b5913ef2b7e19ca563e189cb35d19aa` |
| promote-web | `corely-erp-dev-doa-6cc903951d42-f` | `2026-10-07T23:35:08.437902+00:00` | `6972f43510a4cf054ae24de883171c40fc7750de74c7b37088e4a273a8cd068a` |

Current saved ERP configuration fingerprints equal the last approved specs. Both service UIDs are preserved, both latest Created/Ready names agree, and all nine recorded services are Ready. All **seven other service identities** match the initial baseline, covering full normalized runtime/configuration, tags, actual active revision, UID/generation and latest Created/Ready identities: `ecom-accounting-backend`, `ecom-accounting-frontend`, `corely-wms`, `corely-wms-dev`, `moztech-after-sales-dev`, `corely-aftersales-module-dev`, `moztech-after-sales-system`. API final tag continues referencing f3; API/Web review tags reference their new6cc-C and Web final tag references new6cc-F. Other tags are preserved. No production or WMS service was replaced by this release.

## Two distinct actual UI runs

| Run | Actual tested pair | Started → completed | Raw receipt SHA256 |
| --- | --- | --- | --- |
| After final-web | Review Web6cc-C + review API6cc-C | `2026-10-07T23:31:37.657Z` → `2026-10-07T23:32:36.128Z` | `1c2be9e6c4e8d7b057e96ccb195aafd04b014437edf71b789735b9ed07bde63c` |
| After promote-api | Final Web6cc-F + new canonical API6cc-C | `2026-10-07T23:33:26.277Z` → `2026-10-07T23:34:19.905Z` | `257a630b8eea5f3445409eef5abfca35cc392bc07836fdbf5667612b33da2556` |

Each run has **83 exact unique passed IDs**, the approved ID-set hash `4e6d482ec2aaab47448ac06dff643f7c8dc9256a5a018c94ea85c3deca30b77f`, and **five fresh scenarios across four ordinary role types**: technician QA7001, mailroom QA7002, CSR QA7003 desktop/mobile, and reviewer QA7006. Native global admin remains false; capabilities and source visibility are role-specific. Both runs begin and complete after their relevant recorded phase, and the second is genuinely after API promotion rather than reuse of the first proof.

The exact built bundle `/assets/index-BcUz2XHW.js` with SHA256 `35aa5e5676d068d5d0f87fa9b8f942f33286f29f7f5710da71b2d7c13cc7979b` was observed with status 200 in every scenario. The mounted Source version is actual Source20f / module20f-S. CSR evidence includes eight hydrated original Source entries and six readonly original forms; four category forms honestly retain the original RESHIPMENT default, while reshipment/customer-issue defaults match their own type. Reaching those forms is not successful case creation.

The two accepted receipts bind the exact raw paths/hashes, new source/build/context/images/revisions and fresh timestamp: `acceptance-after-final-web.json` `1079004add431f59c53335866ab55b9ee303cbbab77799cc914b77133bea9c68`; `acceptance-after-promote-api.json` `ec836cb1f681195f3e955a54f1326f8611393d4c27d1dc544066d2e071553b9c`. Each was independently checked with 19 binding/scope assertions. Their safety remains ephemeral contexts, no existing profile read, no credential/token output, no business writes, external origins/WebSockets blocked, auth/SSO POSTs only and no business submit clicks.

These runs do not perform another 83-case normal-auth suite on the canonical Web hostname after Web promotion. Instead the promoted Web is the same already tested immutable final revision; Parent separately observed its actual stable served bundle and mounted Source version afterward. That distinction is retained.

## Final stable observation and independent artifacts

Parent's `final-stable-observation.json`, SHA256 `0186d65849914798669e1c8c8bf3862005a3ae6e7ad1a019392944b4995f645a`, is timestamped `2026-10-07T23:35:35.131585+00:00` after Web promotion. It records fresh current-nine equality, seven non-ERP identities unchanged, actual Source20 revision digests, stable canonical Web bundle and mounted Source version. Those fields agree with the approved state/build and the UI receipts. This is Parent-executed live observation, independently reviewed here; it is not a reviewer-executed cloud read.

| Independent private proof | SHA256 |
| --- | --- |
| independent-final-phase-binding-review.json | `5206a6ff62fa67b2e10533bc06cb3f3b97576bc9e06f0bb07ca899e62e727b26` |
| independent-acceptance-after-final-web-review.json | `c2e388820101652d93ce3dfe27887f68b962c15ca40dd4f424838f92d1d0d48b` |
| independent-acceptance-after-promote-api-review.json | `311424c3ccfa80b291db707da7313c61eedf90152d9dbd56cb580bd645d02749` |

Final state SHA256 at review: `3b3aff75720fa755df14b32839a6c265537ca87e7e1881b22c44e9640fa35a5c`. All cited private artifacts are under `/private/tmp/corely-doa-cleanup-release-20261008`; no full environment, credential or private metadata snapshot is copied into this report.

## Limits retained

**Read-only normal-role UI passed.** Actual real EASON account mapping, exhaustive original button execution, financial reconciliation/refunds, invoice issuance/brand merchant isolation, LINE/AI brand-customer-conversation-assignee binding, physical custody/dispatch receipt and formal inventory movement are **not proven by these UI receipts**. Offline business gates are not executed by the UI verifier. Live bank/provider/customer-notification and consumer integration remain separate acceptance; existing synthetic stock9/10/payment399 evidence stays independent/historical. No migration, business save, true provider call or production mutation is claimed here.

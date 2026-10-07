# Cleanup bilingual knowledge and actual DOM — scoped review, 2026-10-08

Conclusion: **PASS_CONTENT_AND_STATIC_BINDING / PASS_SCOPED_LOCAL_DOM**, with the entire new release **HELD**, not cleared. Root reported an independently reproduced pending-load concurrency P2 in the new mailroom page after this review: refresh failure → pending load-more → successful retry → obsolete load-more settlement can leave `moreBusy` set and suppress polling. The author owns its next fix. Affected source hashes and sourceVersion will need fresh generation after that commit. No deployment or live workflow claim is made here.

Reviewed current root code HEAD: `e4a79bae79a8802682b4944032867b33414e57c3`. The catalog/generated/manifest are parent-owned uncommitted changes; this review only read them. The semantic scope is exactly six guides: `dashboard`, `mailroom-workbench`, `repair-workbench`, `after-sales-customer-workbench`, `after-sales-native-cases`, `after-sales-native-invoices`.

## Semantic result

- The home and workbench text matches the single-title/on-demand help design and preserves all six source type identities. The category create link is correctly described as an original blank form, not automatic type selection.
- Mailroom guidance preserves concrete recipient/personal acceptance, separate notification states and unchanged physical custody until actual acceptance. Failed/unloaded awaiting reads are distinguished from zero cases and never reuse another company/query list. A saved outgoing logistics record, existing progress ACK and pending dispatch consumer remain separate.
- Repair guidance matches the primary document editor/sidebar on desktop and document-first mobile layout, saved-version printing and separate document/physical/formal quote versions. The current page prevents collapsing a busy factory workflow and renders rejection feedback outside it while retaining the draft. DISPATCHED is review-only, with documents/outbound records retained; prior sync receipts are historical rather than current customer notification proof.
- Original source cases, finance and invoices remain canonical instead of a second case or ledger. The new boundary explicitly does **not** claim completed brand/official-account/customer/conversation/assignee binding, brand invoice-merchant isolation, dispatch consumer, virtual-account reconciliation or actual customer notification/payment.
- Chinese and English changes align in meaning. No P1/P2 semantic mismatch was found. One optional precision suggestion was sent to Root: the new mailroom “repair read limited to repairs” statement should name the awaiting `sourceCases` queue; native RETURN refurbishment items continue under existing `isRepairWorkbenchItem` rules. This is not a proposed access change.

## Independent static binding

Catalog `e0ee3ae794420eb9bf35c786470a4ff8a08b08b73500d643a172a639ab62dedc`; generated `23b5ae58be9d400ae038eb09fb6fd395f8b3a928696e731a07ec436493700c5f`; manifest `506731663ec7205ed4332c46d761d9764a2cefb814e4cece9ea0b4310ead5af8`.

Manifest reviewedBase `e4a79bae79a8802682b4944032867b33414e57c3`; sourceVersion `sha256:1dce249624a019812a293505463e77dc111e0f4e7398c46d8e4bae829d909727`. Independently checked **79 generated bilingual entries / 12 groups / 103 routes / 208 source hashes**. All 208 actual file hashes match, sourcePath closure is exact, generated entry content/source references match the catalog, and the version digest recomputes exactly. Deleted `MailroomNextStep.tsx` is absent from catalog and manifest. This checks content and bindings; it does not report the parent's 20 generator and 51 ACL tests as independently executed here.

## Actual local React DOM execution

| Suite | Binding | Result | Log SHA256 |
| --- | --- | --- | --- |
| `workspace-company-dom.test.mjs` | Re-run after HEAD e4 integration, current mailroom page | **9/9 PASS**, fail/skip 0, 14.72 s | `2d45ad7aaa84ce3f0c3f3e8090b6414517f575f00a6cd474c90f6d02f8d78429` |
| `after-sales-module-dom.test.ts` | Run at earlier f8 code, then all affected production/test bytes verified unchanged at e4; not relabeled as an e4 re-run | **8/8 PASS**, fail/skip 0, 17.22 s | `60db3c415c5264121f2b7d09a832e467d5f47245a9997fb2c1cac2251786b0af` |

The workspace fixture uses actual DashboardPage/Layout, workbench pages, entity hook, route permission guards, hub, router and service methods; auth/unrelated widgets/socket/API are controlled synthetic boundaries. The module fixture uses actual Hub/ModulePage/data router/Ant hook modals/navigation guard with controlled native draft queues and a synthetic iframe source. It verifies six service routes, dedicated invoice/accounting grants, no initial legacy launch, forbidden scope/no-grant direct links, disabled module, native tab/overview draft persistence, cancel retention and explicitly discarded fresh intake deep links. No external business API, DB, provider or notification is exercised. This is not proof of all original source buttons, real EASON mapping, physical custody, payment or LINE delivery.

Runner (sequential files, ephemeral localhost test fixture only):

```sh
TS_NODE_TRANSPILE_ONLY=true TS_NODE_EXPERIMENTAL_SPECIFIER_RESOLUTION=node TS_NODE_COMPILER_OPTIONS='{"module":"NodeNext","moduleResolution":"NodeNext","target":"ES2022"}' node --loader ../backend/node_modules/ts-node/esm.mjs --experimental-specifier-resolution=node --test --test-concurrency=1 tests/<suite>
```

Observed affected production bytes at review:

| Source | SHA256 |
| --- | --- |
| `frontend/src/pages/AfterSalesModulePage.tsx` | `8c911cbe6da50b4847b5e71b5b1c3d513c8ecfc3a51740dfee173d634057be4b` |
| `frontend/src/pages/after-sales/AfterSalesWorkbenchHub.tsx` | `0e8362f5d2f506fd767288bdcb7fd113ec1cdc16cedca58b02dc1be323ef5dd0` |
| `frontend/src/pages/after-sales/workbench-model.ts` | `8c9beaef2a4e085ee1d00d28874eef76a955cf26934800a6199f98e4b1535aab` |
| `frontend/src/pages/repair/repair-navigation.ts` | `46d5cec64b064ba9b496bbf0cdfc2068e3b741a0a0b9107700bc87091b348072` |
| `frontend/src/pages/repair/repair-feedback.tsx` | `9e0742ef0ed4c7ced24846e67c7f60c91306ba215ed58b01342c3a7e17d0bb14` |
| `frontend/src/pages/mailroom/MailroomPage.tsx` | `58237330b3127a2ef583d243f16c76eb03eacfb23467456d0c037e52909d61c9` |
| `frontend/src/pages/repair/RepairWorkbenchPage.tsx` | `7a90ca43bd50826ee4ed2508701c13df505d09504d51692c973883677d83685b` |
| `frontend/src/pages/repair/RepairDocuments.tsx` | `7d9e62fc0e3f66b8453cfc6c67ee20de2b6749b0175416d0fd3e3111a9e65323` |
| `frontend/src/pages/repair/RepairReadinessPanel.tsx` | `d5083d34857961a32ef4c288b5f0be257b2d970c7f334c515cef5c2b99ac88b7` |

No product, test, catalog, generated file, release helper owned by Root, historical receipt, cloud or business record was edited by this review. New evidence is restricted to private logs/offline-tool artifacts and these coordinator review files. All earlier failed UI/264 release evidence stays historical and intact.

# ERP development and release workflow

User direction, confirmed 2026-09-23: all corrections go through DEV first. Deploy and validate in DEV; integrate into production only after the user confirms DEV is satisfactory.

- Identify the real checkout, branch/SHA, dirty state, other active work, and the currently serving DEV revisions before changes or release. Preserve other agents' work; use an isolated branch/worktree.
- Integrate the latest approved DEV changes before publishing a candidate. Never deploy an older checkout over newer shared DEV features.
- Keep DEV database, service accounts, secrets, and external-effect isolation separate from production. Keep migrations scoped to reviewed changes and preserve existing user assignments.
- Publish candidate revisions, validate authentication, permissions, affected workflows, and the visible UI, then move DEV traffic. Keep a release receipt with source SHA, image digests, migrations, tests, and rollback revisions.
- Local code, tests, pushed code, deployed DEV, and production acceptance are separate states. Report each accurately.
- When a documented ERP workflow or route changes, review its Corely Claw guide in `backend/src/modules/ai/knowledge`, update both languages and source hashes only after that review, and run the knowledge coverage/drift check before release. A new guide does not automatically authorize a new AI data tool or business operation.
- A DEV deployment request does not authorize production deployment, production migrations, or production traffic changes. Production integration requires the user's later confirmation.

# Product interface rules

User direction, reaffirmed 2026-10-08: keep every feature's operating interface clean. Do not add persistent explanatory annotations, developer commentary, workflow tutorials, technical implementation notes, or lengthy permission/finance/integration disclaimers to pages, forms, cards, or buttons.

Reference: warranty-platform `docs/ui-design-principles.md`, verified at `6f59aa230bcc841bc261f3125f368a9208a034ca`; the user requested the same low-distraction direction across subsequent systems. Its ProductsPage, WarrantiesPage and WarrantyEditorPage put data first, use compact action bars, and expand secondary details on demand.

- Use concise page titles, field labels, action names, and actual case/product/document data. A button names its action; do not append a sentence explaining the system.
- Show one page name and only the necessary actions in the header. Keep lists, forms and other work data clearly separated. Prefer one primary next action; secondary actions use ordinary buttons or an appropriate menu.
- Expose search, advanced filters and secondary details on demand. Applied filters must remain identifiable and removable. Collapse actual records or optional operations, not unwanted explanatory paragraphs.
- Remove redundant subtitles and routine information banners. Do not merely move unwanted commentary into another card or collapsed section.
- Show brief, specific feedback only when it helps the current action: required input, an actual blocker, a changed version, a failed operation, or confirmation of a consequential action. Keep truthful case records, permissions, validation and workflow gates intact.
- Put general instructions in Corely Claw's page help ("這頁怎麼用") and review both guide languages when interaction changes. Help text must not be required to understand the basic screen.
- DEV/DEMO identity, an unconnected service, real errors and permission restrictions must remain truthful. Saving a draft, previewing and publishing stay distinct; visual simplification never changes data, scope, exports, action contracts or permission checks.
- Review related pages together and all visible copy/buttons in normal, empty, no-results, loading, disabled, error, readonly, editing, preview and dialog states. Check keyboard focus and mobile behavior at comparable sizes. Local tests do not establish full operational acceptance. These rules apply to existing fixes and all future features across the system.
- This requirement concerns user-visible interface annotations; retain useful source-code comments and technical documentation outside the operating UI.

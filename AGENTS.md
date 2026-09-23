# ERP development and release workflow

User direction, confirmed 2026-09-23: all corrections go through DEV first. Deploy and validate in DEV; integrate into production only after the user confirms DEV is satisfactory.

- Identify the real checkout, branch/SHA, dirty state, other active work, and the currently serving DEV revisions before changes or release. Preserve other agents' work; use an isolated branch/worktree.
- Integrate the latest approved DEV changes before publishing a candidate. Never deploy an older checkout over newer shared DEV features.
- Keep DEV database, service accounts, secrets, and external-effect isolation separate from production. Keep migrations scoped to reviewed changes and preserve existing user assignments.
- Publish candidate revisions, validate authentication, permissions, affected workflows, and the visible UI, then move DEV traffic. Keep a release receipt with source SHA, image digests, migrations, tests, and rollback revisions.
- Local code, tests, pushed code, deployed DEV, and production acceptance are separate states. Report each accurately.
- A DEV deployment request does not authorize production deployment, production migrations, or production traffic changes. Production integration requires the user's later confirmation.

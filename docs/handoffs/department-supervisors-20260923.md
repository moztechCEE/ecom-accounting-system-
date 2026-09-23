# Department supervisor binding — DEV handoff

## Scope and source

- Isolated worktree: `/Users/moztecheason/ecom-department-supervisors-20260923`, branch `codex/department-supervisors-20260923`.
- Runtime source: `0cc070b7`; retains the WMS entry/audit source `53188aab` and Corely Claw release `d366985f`.
- Other active ERP/WMS handover work was inspected and its checkout left untouched. Production and `main` are outside this release.

## Behavior

- Employee editor exposes 所屬部門 and 部門主管. Department editor specifies one shared work role and one additional supervisor work role. Multiple supervisors may belong to one department; each employee has one department.
- Department permissions are computed on each server request. Supervisors retain shared work permissions; personal role assignments are neither replaced nor persisted as derived assignments.
- Active department members receive attendance, leave, profile and expense self-service. Active supervisors additionally receive `attendance_team:read/review`, with department-scoped attendance/leave access. Personal salary, finance, access administration, global attendance configuration and complete audit-log grants are not inherited through department roles.
- Explicit personal data scopes remain stored unchanged; `/users/me` reports effective attendance scope separately. Transfer, demotion or deactivation removes derived access on the next request. The ERP UI refreshes its menu on page reload.
- Department binding requires employee-management access plus access-management authority. Privileged roles cannot be department templates; roles still referenced by a department cannot be deleted.
- Expense approval still follows the explicitly assigned direct supervisor. Previously assigned requests are not rerouted. No actual employee was guessed or marked as a supervisor.
- Scoped supervisors use a compact attendance/leave page. They cannot review their own leave, other departments' leave, or global policy/balance settings. Attendance responses omit salary/national-ID fields; leave actor references return only ID/name.
- Saving from the employee editor's Basic tab preserves data from unopened tabs, preventing the existing blank-login-email error and unintended clearing of other fields.
- WMS ticket and workspace permission checks, expense access, account previews and Copilot access use the same department-derived operation grants. WMS station choice remains picker/packer under one warehouse staff concept.

## Migration and verification

- DEV-only additive migration: `20260923110000_department_supervisors`. Adds employee boolean, department-role foreign keys and a supervisor-requires-department constraint. Existing supervisor flags start false. SQL was first verified in a rolled-back transaction, then applied and recorded with checksum in DEV.
- Backend focused checks: 163 passing. Frontend navigation/access/warehouse regression checks: 23 passing. Both production builds pass; bilingual knowledge coverage/drift check passes (55 guides, 64 routes, 81 reviewed sources).
- Actual final candidate and canonical DEV API checks: 48 passing on each, including same/other department visibility, direct API authorization, active-session transfer/demotion, sensitive-field omission and role deletion protection.
- Browser checks use actual DEV APIs and isolated fixture identities. Five checks passed on both the final candidate and canonical DEV URLs, covering saved fields, two real supervisor-toggle saves, department templates, scoped supervisor page, self-review prevention and attendance display. Initial form failure was retained and fixed before release. QA identities were subsequently disabled and their roles, department templates, attendance and leave fixtures removed; audit evidence remains.
- Artifact directory: `/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/artifacts/department-supervisors-20260923`. Cloud configuration snapshots and QA credentials are private and must not be committed.

## Remaining acceptance boundaries

- The administrator must explicitly configure each real department's shared/additional roles and identify its supervisors. Existing direct grants may intentionally give an individual additional rights beyond the department baseline.
- Automatic department data scope in this change covers attendance/leave. WMS analyses keep their existing warehouse/company scope and require an explicitly selected additional operation role; this is not department-level filtering of every ERP/WMS business report.
- No broad department-based salary, bank-payment, account-administration, overtime-final-review or organization-editing grant is implied.
- Production integration still requires the user's DEV acceptance. No production migration, merge to main or production traffic change is authorized by this handoff.

## Deployment status

- Deployed and verified on canonical DEV: API `corely-erp-api-dev-department2-0923` and web `corely-erp-dev-department2-0923`, each carrying 100% DEV traffic.
- Runtime source is `0cc070b7`, Cloud Build `e62dafd3-ae4a-4760-b532-4a5420403227`. Documentation commits after this runtime commit do not imply a new deployment.
- Immutable image digests, rollback revisions, fresh API/browser results and QA cleanup are recorded in `department-supervisors-release-20260923.json`.
- Production ERP API/web and WMS service configurations were checked against the pre-release snapshots and remain unchanged. No production migration, production deployment, or merge to `main` was performed.
- Other ongoing B2B/WMS handover work must retain this runtime commit and migration when preparing a subsequent ERP DEV release. This release does not include that task's unfinished handover changes.

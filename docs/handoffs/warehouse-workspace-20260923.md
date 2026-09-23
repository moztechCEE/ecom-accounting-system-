# 儲運工作台整合 — 2026-09-23

## Scope and ownership
- User authorized a simple warehouse employee workspace: choose picking/packing, unified ERP permissions, self attendance/leave/expense/profile, announcements inside the workbench.
- ERP: isolated `codex/warehouse-workspace-20260923` at `/Users/moztecheason/ecom-warehouse-workspace-20260923`, based on deployed `2e45e6c5`.
- WMS: isolated `codex/wms-workspace-20260923` at `/Users/moztecheason/corely-wms-workspace-20260923`, based on deployed `16d7668`. Preserves the other task's current batch-return and scan UI changes.
- Read remote branches, worktrees, workflows and current Cloud Run traffic before editing. No remote merge or production release authorized/performed in this task.
- Overlap: ERP navigation/App/AuthContext/access control/expense controller/JWT DEV allowlist; WMS App/task layout/HTTP and Socket auth. Future merge must preserve newer changes in both repositories.

## Behavior
- Warehouse staff sidebar has a single local workbench plus personal self-service links. Authorized picking/packing cards open the existing full WMS workflow in a new tab.
- One-use 60-second ticket is delivered via postMessage to an exact-origin, exact-window, nonce-bound popup. No password, ERP token or ticket in URLs. Backend exchange uses a dedicated DEV service key. WMS issues a role-limited 8-hour absolute session and rechecks active ERP account, password version, company and current work permission on every HTTP request. Socket account recheck is bounded at 60 seconds.
- Selecting another work role revokes previous ERP warehouse sessions. ERP logout revokes warehouse sessions; WMS '離開作業' returns to ERP. Existing local WMS account login remains for accounts not linked to ERP.
- New ERP identities get stable numeric WMS IDs. Administrators can explicitly bind an existing picker/packer through 帳號與權限 → 儲運帳號 BEFORE first use, preserving order ownership. No email/name guessing, no rebind over existing history, no admin/superadmin mapping. Bound accounts use ERP authentication only; legacy password/refresh/socket access is denied while integration is enabled.
- Three role templates: 儲運揀貨員 / 儲運裝箱員 / 儲運作業員 (both). No existing staff role or company membership is automatically changed. These templates include basic personal permissions. ERP employee records are still required for attendance/leave workflows.
- Announcements are displayed on WMS workbench. Completed tasks remain its existing tab. Conversion/release/exceptions are workbench links; logistics is under 訂單銷售, defects under 採購庫存, scan errors under 人資考勤, settings/logs under 系統管理. Existing management pages retain their WMS authorization; this release provides employee work-session SSO, not a new supervisor role.
- Employee expense list/detail/history are scoped by backend to self; no accounting or purchase read permission is required merely to see the self expense entry.

## DEV boundary
- ERP DEV DB only: `erp_dev_20260921`; WMS DEV DB only: `corely_wms_dev_20260915`. Bind WMS to `tw-entity-001`; do not expose this warehouse to another company by changing frontend selection.
- DEV outbound guard allows ONLY internal DEV WMS staff lookup/binding POSTs. Production hosts, external synchronization, sending, callbacks and subprocess automation remain blocked.
- Schema additions: ERP `20260923010000_warehouse_workspace`; WMS `034_erp_staff_identity.sql`. Existing business tables and history are preserved.

## Verification and release
- Deployed to DEV, all three Ready with 100% traffic: `corely-erp-api-dev-workspace-0923`, `corely-erp-dev-workspace-0923`, `corely-wms-dev-workspace-0923`.
- ERP runtime source `8897ddcb`; UUID v4 schema correction source `1a4244cb`; WMS runtime source `eca381b`. ERP build `21d47c73-77a3-4cd3-b3c3-a19fbc89116c`; WMS build `d46440c2-dc7d-4714-a03e-99444156af84`.
- Additional migration history `20260923020000_warehouse_role_identifiers` and `20260923030000_warehouse_role_uuid_v4` correct new role/permission IDs to existing DTO UUID v4 requirements. FK cascades preserve assigned roles/permissions. Previously applied migration files were not rewritten.
- ERP: 18 navigation/access UI tests, 7 service/expense access tests, 21 isolated PostgreSQL cross-system assertions, DEV outbound sandbox check, Prisma validation and backend/frontend builds passed.
- WMS: 280 backend tests, 272 frontend tests and production frontend build passed. The socket-session harness now verifies HTTP credentials are installed synchronously before task effects start.
- Live DEV APIs: 11 checks passed for scoped role selection, replay, stable numeric actor identity, immediate role revocation, logout, self expense access and restricted internal staff lookup.
- Legacy binding: 7 checks using a newly created, clearly labeled DEV legacy-style picker fixture. Binding preserved numeric ID; original password and old JWT lost access; rebind to another ERP user was rejected. No actual employee account was bound or changed.
- Authenticated isolated Chrome context: real ERP login, compact sidebar, picking and packing popups without WMS password login, announcement region, return to ERP expense page, attendance/leave/expense pages and picker-only mobile entry passed; zero captured page errors. Real DEV task lists loaded. No order claim/scan/import/stock/payment was performed.
- QA users (operator/picker/admin) and the two employee fixtures were disabled afterward; portal sessions revoked. WMS QA mappings point to inactive ERP accounts and cannot use legacy login. Private credentials remain only in local mode-0600 QA artifacts.
- Production ERP API, ERP frontend and WMS specs/traffic match the preflight baseline. No push or GitHub merge. Other source worktrees unchanged.
- Release receipt: `warehouse-workspace-release-20260923.json`; local evidence and screenshots under `/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/artifacts/warehouse-workspace-20260923`.

## Deployment coordination detail
The ERP API's previous traffic configuration followed `latestRevision`. Replacing its configuration moved DEV traffic to the new candidate immediately; it was verified and then pinned explicitly. Frontend candidate preparation was corrected to pin the old revision before staging, and WMS was already revision-pinned. Future releases must resolve every `latestRevision` entry to the preflight revision before creating a candidate. This affected DEV only.

## Human setup / remaining acceptance
Assign each real warehouse employee one of the three templates and correct company membership in ERP. If they already have a WMS identity, explicitly bind it before first ERP workbench use so their existing tasks remain attached. Do not auto-grant all staff or infer mappings by name. Physical barcode scanning, printers, clock-in/leave/expense submission, real staff account mappings, management-report SSO/fine-grained supervisor role and company-wide performance analysis have not been accepted by this release.

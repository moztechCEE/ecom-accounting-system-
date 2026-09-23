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
Pending final DEV release and authenticated browser acceptance. Source tests, migration transaction rehearsal and release receipts are recorded below when complete. Physical scanning, printing, stock changes and company-wide HR performance acceptance are not implied.

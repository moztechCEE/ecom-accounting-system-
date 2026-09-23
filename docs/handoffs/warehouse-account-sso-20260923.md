# ERP warehouse account and dispatch SSO — 2026-09-23

## Scope and ownership

- ERP checkout `/Users/moztecheason/ecom-warehouse-account-sso-20260923`, branch `codex/warehouse-account-sso-20260923`.
- WMS checkout `/Users/moztecheason/corely-wms-dispatch-sso-20260923`, branch `codex/wms-dispatch-sso-20260923`.
- Based on reviewed ERP `04d0e6f9` and WMS `a7e979f`, including the independently completed product-save fix `be971b5f` as `c52b2ff5`.
- ERP runtime source `70702171`; WMS `86550cc`.
- Remote main checked: ERP `a3791c48`; WMS `543c6dd3`. No push or main merge in this task.
- Another active task is editing `/Users/moztecheason/ecom-access-expense-ai-20260923`. It remains uncommitted work, not copied or deployed here. Overlap: role service, account page, navigation/layout, frontend types. Reconcile both branches before its release; do not deploy that older `8897ddcb` base over this release.

## Implemented

- ERP 出貨管理 menu and command search use the existing one-time, nonce-bound SSO exchange. Direct bookmarked ERP dispatch page offers an explicit launch button, avoiding automatic popup blocking.
- ERP requires both `wms_tasks:read` and `wms_orders:create` for dispatch, or an existing administrator role. WMS grants the dispatcher work scope; choosing dispatch does not grant WMS administrator capabilities.
- WMS opens `/admin` after exchange; picking/packing still open `/tasks`. All retain the same immutable ERP-to-numeric-WMS user mapping. Existing dispatcher accounts can be explicitly linked; no name/email guessing.
- Warehouse stock roles consolidated into existing `WAREHOUSE_OPERATOR`, displayed as 倉儲人員. Prior picker/packer assignments transfer to that role. Existing WMS identities/history remain intact. Migration stops if a legacy role has permissions beyond the combined template.
- Personal name editing is independent of employee onboarding and 2FA. Loading disables editing; persistent feedback reports save results. Self-service DTO accepts only name, never roles, company scope, or another user ID.
- Optional 2FA panel reports actual persisted state. Fixed authenticated user ID; enrollment is bound to user/password version, expires in ten minutes, and requires current password plus a valid OTP. Enrollment JWTs cannot authenticate API requests. Once enabled, all ERP login modes require OTP. No real user's 2FA was enabled or reset by this task; enrollment requires the user to scan and verify on their own authenticator.
- Role list reports assigned account counts and deletion reasons. Used roles require reassignment first; unused ADMIN can only be deleted by SUPER_ADMIN. SUPER_ADMIN remains protected. Delete locks the role before counting FK assignments to prevent concurrent assignment loss. No real administrator role or assignment was removed.

## DEV database changes

Applied to `erp_dev_20260921` only:

- `20260923040000_warehouse_dispatch`
- `20260923050000_warehouse_staff_role`

WMS schema stays at migration 034. Production remains unchanged. DEV external sync/sending restrictions retained.

## Verification and deployment receipt

Evidence directory: `/Users/moztecheason/Documents/ChatGPT/AI ERP 系統/artifacts/warehouse-account-sso-20260923`.

- ERP scoped Jest: 13 passed; navigation/access UI tests: 18 passed; PostgreSQL cross-system assertions: 25 passed; DEV sandbox check passed.
- WMS full backend/frontend suites and frontend build passed.
- Both ERP builds passed. Initial browser run caught an initial-load profile editing race and missing durable feedback; fixed before final browser acceptance.
- Live API: 17 checks passed; cross-system handoff: 18 checks passed; browser: all 6 scenarios passed with no page errors. Exact revisions/digests are recorded in `warehouse-account-release-20260923.json`. ERP API/web `account-sso2-0923` and WMS `account-sso-0923` each receive 100% DEV traffic.
- All four new DEV QA accounts are disabled; their sessions are revoked and temporary role assignments removed. Test identities are isolated from real employees. No business orders imported, claimed, packed or shipped during these tests.

## Remaining acceptance

- User completes their own authenticator enrollment (scan QR, current password, six-digit OTP). Do not ask for password or OTP in chat.
- Existing WMS staff with historical accounts should use explicit account linkage before their first ERP entry.
- Supervisor analytics/settings links remain a separate integration scope; this release fixes 出貨管理 and preserves pick/pack SSO.
- Physical warehouse operations and production release were not performed.

# ERP DEV account form follow-up — 2026-09-22

## Ownership and version
- Worktree: `/Users/moztecheason/ecom-erp-dev-20260921`, branch `codex/erp-dev-environment-20260921`.
- Source commit: `21d71a2d`; no merge or push. Original dirty checkout preserved.
- Remote main `a3791c4886bf92025020812d3f30150c974060a6` and operations branch `2ec8282d1975988f93bf6466c372d4b84475ef44` rechecked before release.
- Shared files: `frontend/src/main.tsx`, `frontend/src/pages/AccessControlPage.tsx`. Operations worktree had no uncommitted changes in these files when checked.

## Changes
- Removed the fixed yellow DEV footer. DEV database, network sandbox, schedules, and authentication configuration remain unchanged.
- Limited create-user form body height and made it scrollable; footer buttons remain visible.
- Persist API errors in the modal, explain duplicate-email errors in Chinese, and preserve validation-array details.
- Prevent concurrent create requests, preserve entered values on failure, scroll to invalid fields, and show page 1 after a successful create.

## Evidence and limits
- Cloud Run request logs show POST `/api/v1/users` returning 409 repeatedly on 2026-09-22 at 01:52–01:53 UTC. Those requests reached the API; they were not blocked by the DEV sandbox.
- The backend returns 409 for an existing normalized email or a Prisma unique constraint violation. Request logs do not retain the response body; the user's email field was blank when inspected. The exact original conflicting account/value remains unconfirmed; user clarification requested. Do not claim an account was created or the original data conflict was resolved.
- Live read-only user list showed one TEST-named account created through a different employee-account path. It does not prove the failed user-create requests succeeded.
- Original create-modal footer extended to y=1183 in a 982px viewport.
- Four error-handling tests passed; frontend and backend builds passed.
- Local browser fixture: double-click triggered exactly one simulated request; duplicate-email error remained visible; footer ended at y=661 in a 720px viewport.
- Local fixture never contacts a real API and creates no accounts. No user passwords or permissions changed.

## Deployment
- Cloud Build: `7b68ba82-6f41-4b8a-87dd-fcc4f5056249`.
- Frontend-only DEV release completed: `corely-erp-dev-00003-x72`, 100% traffic, generation 3. Image `sha256:fc91b158429c42feda0281759c9ddd9a7302bb081614dd44f3977394f6de6a28`.
- Live authenticated browser loaded `index-DK_mFUJW.js`; footer banner absent, modal body scrollable, create buttons visible (footer bottom y=609 in 720px viewport).
- DEV backend remains `corely-erp-api-dev-00002-d4n`, generation 2. The backend image produced by the build was not deployed.
- Post-release check confirmed production traffic and generations unchanged. No account creation was performed in the live browser.
- Production backend `ecom-accounting-backend-00506-ray`, generation 509; frontend `ecom-accounting-frontend-00270-vob`, generation 271, both at 100% when audited. No production deployment authorized or performed.

# DEV product save feedback — 2026-09-23

## Scope and source

- Isolated checkout: `/Users/moztecheason/ecom-product-save-feedback-20260923`, branch `codex/product-save-feedback-20260923`.
- Based on the serving DEV source `8897ddcbc5c6`; frontend fix commit `be971b5fd367`.
- The previous Save button called `form.submit()`. Valid product creation worked, but invalid fields only showed inline errors in a long modal. API failures such as duplicate SKU appeared only in a short toast.
- The product modal now keeps validation and API errors visible, scrolls to the first invalid field, and uses Chinese required-field messages. Product data rules and backend code are unchanged.

## Verification and DEV release

- Local frontend build passed. Targeted ESLint reported the same seven pre-existing errors as the baseline; no new lint errors.
- Cloud Build `ac30b7b2-352d-45f5-ad7e-66f7df97c865` built only the frontend image, digest `sha256:f6cc8e4015602ea7d797d90dfe926fdb1615ede5b400f9d2d9d6a232dc70d206`.
- Cloud Run revision `corely-erp-dev-psave-be971b5f` is Ready and serves 100% of DEV web traffic. The previous `corely-erp-dev-workspace-0923` remains available at 0%. DEV API remains `corely-erp-api-dev-workspace-0923` at 100%; WMS DEV and production ERP traffic were unchanged.
- Authenticated browser acceptance on the canonical DEV URL: an empty form showed all three required-field errors in a persistent alert; duplicate SKU showed the backend's 409 explanation in the same alert; a valid SN-tracked product was created, then reloaded and edited to confirm style, color, model code, barcode, and SN tracking persisted.
- DEV test products `DEV-SAVE-QA-0923-K72` and `DEV-SAVE-QA-0923-K73` remain in the product catalog for traceability. No inventory, serial batch, or accounting records were created by this test.

## Release boundary

This was a DEV web-only release. The branch is not merged into `main`; pushing `main` would trigger production workflows and needs a separate integration review.

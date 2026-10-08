-- Additive, nullable fields preserve existing expense requests and manual submissions.
-- PostgreSQL unique indexes allow multiple NULL values; only Copilot submissions
-- claim a server-derived company/user/draft key. Do not backfill historic requests.
ALTER TABLE "expense_requests"
  ADD COLUMN "submission_key" TEXT,
  ADD COLUMN "submission_payload_hash" TEXT;

CREATE UNIQUE INDEX "expense_requests_submission_key_key"
  ON "expense_requests"("submission_key");

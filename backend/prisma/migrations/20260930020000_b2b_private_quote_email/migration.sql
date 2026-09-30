ALTER TABLE "b2b_issued_quotes" ADD COLUMN "accepted_by_email" TEXT;
ALTER TABLE "b2b_issued_quotes" DROP CONSTRAINT "b2b_issued_quotes_status_valid";
ALTER TABLE "b2b_issued_quotes" ADD CONSTRAINT "b2b_issued_quotes_status_valid"
  CHECK ("status" IN ('delivery_pending','sent','accepted','superseded','withdrawn'));
ALTER TABLE "b2b_issued_quotes" DROP CONSTRAINT "b2b_issued_quotes_accepted_pair";
ALTER TABLE "b2b_issued_quotes" ADD CONSTRAINT "b2b_issued_quotes_accepted_pair" CHECK (
  ("status" IN ('delivery_pending','sent','superseded') AND "accepted_at" IS NULL
    AND "accepted_by_account_id" IS NULL AND "accepted_by_email" IS NULL
    AND "withdrawn_at" IS NULL AND "withdrawn_by" IS NULL AND "withdrawal_reason" IS NULL)
  OR ("status" = 'accepted' AND "accepted_at" IS NOT NULL
    AND (("accepted_by_account_id" IS NOT NULL AND "accepted_by_email" IS NULL)
      OR ("accepted_by_account_id" IS NULL AND "accepted_by_email" IS NOT NULL))
    AND "withdrawn_at" IS NULL AND "withdrawn_by" IS NULL AND "withdrawal_reason" IS NULL)
  OR ("status" = 'withdrawn' AND "accepted_at" IS NOT NULL
    AND (("accepted_by_account_id" IS NOT NULL AND "accepted_by_email" IS NULL)
      OR ("accepted_by_account_id" IS NULL AND "accepted_by_email" IS NOT NULL))
    AND "withdrawn_at" IS NOT NULL AND "withdrawn_by" IS NOT NULL
    AND "withdrawal_reason" IS NOT NULL AND length(trim("withdrawal_reason")) >= 10)
);

CREATE TABLE "b2b_quote_email_accesses" (
  "id" TEXT NOT NULL,
  "issued_quote_id" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "recipient_email" TEXT NOT NULL,
  "verification_reason" TEXT NOT NULL,
  "verified_by" TEXT NOT NULL,
  "verified_at" TIMESTAMPTZ NOT NULL,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "send_state" TEXT NOT NULL DEFAULT 'SENDING',
  "attempt_id" TEXT NOT NULL,
  "send_lease_until" TIMESTAMPTZ NOT NULL,
  "sent_at" TIMESTAMPTZ,
  "consumed_at" TIMESTAMPTZ,
  "revoked_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "b2b_quote_email_accesses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "b2b_quote_email_accesses_state_valid" CHECK (
    ("send_state" = 'SENDING' AND "sent_at" IS NULL AND "consumed_at" IS NULL)
    OR ("send_state" = 'FAILED' AND "sent_at" IS NULL AND "consumed_at" IS NULL AND "revoked_at" IS NOT NULL)
    OR ("send_state" = 'SENT' AND "sent_at" IS NOT NULL)
  ),
  CONSTRAINT "b2b_quote_email_accesses_expiry_valid" CHECK ("expires_at" > "verified_at"),
  CONSTRAINT "b2b_quote_email_accesses_token_hash_valid" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "b2b_quote_email_accesses_recipient_normalized" CHECK (
    length("recipient_email") > 3 AND "recipient_email" = lower(trim("recipient_email")))
);
CREATE UNIQUE INDEX "b2b_quote_email_accesses_issued_quote_id_key"
  ON "b2b_quote_email_accesses"("issued_quote_id");
CREATE UNIQUE INDEX "b2b_quote_email_accesses_token_hash_key"
  ON "b2b_quote_email_accesses"("token_hash");
CREATE INDEX "b2b_quote_email_accesses_expires_at_idx"
  ON "b2b_quote_email_accesses"("expires_at");
ALTER TABLE "b2b_quote_email_accesses" ADD CONSTRAINT "b2b_quote_email_accesses_issued_quote_id_fkey"
  FOREIGN KEY ("issued_quote_id") REFERENCES "b2b_issued_quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

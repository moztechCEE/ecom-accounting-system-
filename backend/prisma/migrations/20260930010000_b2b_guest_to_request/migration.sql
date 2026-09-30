-- A verified guest inquiry can enter the internal B2B stock-review flow once.
-- Portal-created requests retain their existing account and PO requirements.
ALTER TABLE "b2b_purchase_requests"
  ADD COLUMN "source_kind" TEXT NOT NULL DEFAULT 'PORTAL',
  ADD COLUMN "source_guest_inquiry_id" TEXT,
  ALTER COLUMN "account_id" DROP NOT NULL,
  ALTER COLUMN "customer_po_number" DROP NOT NULL;

CREATE UNIQUE INDEX "b2b_guest_inquiries_id_entity_id_key"
  ON "b2b_guest_inquiries"("id", "entity_id");
CREATE UNIQUE INDEX "b2b_purchase_requests_source_guest_inquiry_id_key"
  ON "b2b_purchase_requests"("source_guest_inquiry_id");
CREATE UNIQUE INDEX "b2b_purchase_requests_source_guest_inquiry_id_entity_id_key"
  ON "b2b_purchase_requests"("source_guest_inquiry_id", "entity_id");

ALTER TABLE "b2b_purchase_requests"
  ADD CONSTRAINT "b2b_purchase_requests_source_guest_inquiry_id_entity_id_fkey"
  FOREIGN KEY ("source_guest_inquiry_id", "entity_id")
  REFERENCES "b2b_guest_inquiries"("id", "entity_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "b2b_purchase_requests"
  ADD CONSTRAINT "b2b_purchase_requests_source_kind_valid" CHECK (
    ("source_kind" = 'PORTAL' AND "account_id" IS NOT NULL
      AND "source_guest_inquiry_id" IS NULL
      AND "customer_po_number" IS NOT NULL)
    OR
    ("source_kind" = 'GUEST' AND "account_id" IS NULL
      AND "source_guest_inquiry_id" IS NOT NULL)
  );

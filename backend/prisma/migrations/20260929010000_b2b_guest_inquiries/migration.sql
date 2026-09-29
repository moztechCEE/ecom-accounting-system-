-- Guest inquiries are independent, unpriced sales leads. They cannot reserve
-- inventory or become a B2B purchase request without a later approved flow.
CREATE TABLE "b2b_guest_inquiries" (
  "id" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "request_id" TEXT NOT NULL,
  "payload_hash" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "company_name" TEXT NOT NULL,
  "contact_name" TEXT NOT NULL,
  "contact_email" TEXT NOT NULL,
  "contact_phone" TEXT,
  "customer_po_number" TEXT,
  "note" TEXT,
  "status" TEXT NOT NULL DEFAULT 'NEW',
  "matched_customer_id" TEXT,
  "matched_at" TIMESTAMPTZ,
  "matched_by" TEXT,
  "match_reason" TEXT,
  "rejected_at" TIMESTAMPTZ,
  "rejected_by" TEXT,
  "rejection_reason" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "b2b_guest_inquiries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "b2b_guest_inquiry_status_valid" CHECK (
    ("status" = 'NEW' AND "matched_customer_id" IS NULL AND "matched_at" IS NULL AND "matched_by" IS NULL AND "match_reason" IS NULL
      AND "rejected_at" IS NULL AND "rejected_by" IS NULL AND "rejection_reason" IS NULL)
    OR ("status" = 'MATCHED' AND "matched_customer_id" IS NOT NULL AND "matched_at" IS NOT NULL AND "matched_by" IS NOT NULL AND "match_reason" IS NOT NULL AND length(trim("match_reason")) >= 10
      AND "rejected_at" IS NULL AND "rejected_by" IS NULL AND "rejection_reason" IS NULL)
    OR ("status" = 'REJECTED' AND "matched_customer_id" IS NULL AND "matched_at" IS NULL AND "matched_by" IS NULL AND "match_reason" IS NULL
      AND "rejected_at" IS NOT NULL AND "rejected_by" IS NOT NULL AND "rejection_reason" IS NOT NULL AND length(trim("rejection_reason")) >= 10)
  )
);
CREATE UNIQUE INDEX "b2b_guest_inquiries_reference_key" ON "b2b_guest_inquiries"("reference");
CREATE UNIQUE INDEX "b2b_guest_inquiries_entity_id_request_id_key" ON "b2b_guest_inquiries"("entity_id", "request_id");
CREATE INDEX "b2b_guest_inquiries_entity_id_status_created_at_idx" ON "b2b_guest_inquiries"("entity_id", "status", "created_at");
ALTER TABLE "b2b_guest_inquiries" ADD CONSTRAINT "b2b_guest_inquiries_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "b2b_guest_inquiries" ADD CONSTRAINT "b2b_guest_inquiries_matched_customer_id_entity_id_fkey" FOREIGN KEY ("matched_customer_id", "entity_id") REFERENCES "customers"("id", "entity_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "b2b_guest_inquiry_items" (
  "id" TEXT NOT NULL,
  "inquiry_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "sku" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "msrp" DECIMAL(18,2) NOT NULL,
  "currency" TEXT NOT NULL,
  "tax_basis" TEXT NOT NULL,
  "line_total" DECIMAL(18,2) NOT NULL,
  "sort_order" INTEGER NOT NULL,
  CONSTRAINT "b2b_guest_inquiry_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "b2b_guest_item_snapshot_valid" CHECK (
    "quantity" > 0 AND "msrp" > 0 AND "line_total" = "msrp" * "quantity"
    AND "currency" = 'TWD' AND "tax_basis" IN ('TAX_INCLUDED','TAX_EXCLUDED')
  )
);
CREATE UNIQUE INDEX "b2b_guest_inquiry_items_inquiry_id_product_id_key" ON "b2b_guest_inquiry_items"("inquiry_id", "product_id");
ALTER TABLE "b2b_guest_inquiry_items" ADD CONSTRAINT "b2b_guest_inquiry_items_inquiry_id_fkey" FOREIGN KEY ("inquiry_id") REFERENCES "b2b_guest_inquiries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Keys are HMACs of trusted request IP, contact email, or entity and a
-- 10-minute bucket start. Raw IP/contact values are never persisted here.
CREATE TABLE "b2b_guest_rate_buckets" (
  "key_hash" TEXT NOT NULL,
  "window_start" TIMESTAMPTZ NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "b2b_guest_rate_buckets_pkey" PRIMARY KEY ("key_hash"),
  CONSTRAINT "b2b_guest_rate_attempts_nonnegative" CHECK ("attempts" >= 0)
);
CREATE INDEX "b2b_guest_rate_buckets_window_start_idx" ON "b2b_guest_rate_buckets"("window_start");

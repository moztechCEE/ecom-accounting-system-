-- Issued customer quotations are immutable snapshots of a reviewed B2B request.
-- Customer acceptance is recorded separately from staff quotation status updates.
CREATE TABLE "b2b_stock_reviews" (
  "id" TEXT NOT NULL,
  "request_id" TEXT NOT NULL,
  "reviewed_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "reviewed_by" TEXT NOT NULL,
  "result_status" TEXT NOT NULL,
  "confirmed_quantities" JSONB NOT NULL,
  "review_note" TEXT,
  "delivery_date" DATE,
  CONSTRAINT "b2b_stock_reviews_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "b2b_stock_reviews_request_id_reviewed_at_idx" ON "b2b_stock_reviews"("request_id","reviewed_at");
ALTER TABLE "b2b_stock_reviews" ADD CONSTRAINT "b2b_stock_reviews_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "b2b_purchase_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "b2b_issued_quotes" (
  "id" TEXT NOT NULL,
  "request_id" TEXT NOT NULL,
  "quotation_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'sent',
  "issued_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "issued_by" TEXT NOT NULL,
  "accepted_at" TIMESTAMPTZ,
  "accepted_by_account_id" TEXT,
  CONSTRAINT "b2b_issued_quotes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "b2b_issued_quotes_version_positive" CHECK ("version" > 0),
  CONSTRAINT "b2b_issued_quotes_status_valid" CHECK ("status" IN ('sent','accepted','superseded')),
  CONSTRAINT "b2b_issued_quotes_accepted_pair" CHECK (("accepted_at" IS NULL) = ("accepted_by_account_id" IS NULL))
);
CREATE UNIQUE INDEX "b2b_issued_quotes_quotation_id_key" ON "b2b_issued_quotes"("quotation_id");
CREATE UNIQUE INDEX "b2b_issued_quotes_request_id_version_key" ON "b2b_issued_quotes"("request_id","version");
CREATE INDEX "b2b_issued_quotes_status_issued_at_idx" ON "b2b_issued_quotes"("status","issued_at");
ALTER TABLE "b2b_issued_quotes" ADD CONSTRAINT "b2b_issued_quotes_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "b2b_purchase_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "b2b_issued_quotes" ADD CONSTRAINT "b2b_issued_quotes_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "sales_quotations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "b2b_issued_quotes" ADD CONSTRAINT "b2b_issued_quotes_accepted_by_account_id_fkey" FOREIGN KEY ("accepted_by_account_id") REFERENCES "b2b_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Supplier purchase orders retain explicit request-line provenance. Creating a
-- PO does not move stock; receipt remains the only stock-in operation.
ALTER TABLE "purchase_orders"
  ADD COLUMN "source_b2b_request_id" TEXT,
  ADD COLUMN "source_request_key" TEXT,
  ADD COLUMN "source_payload_hash" TEXT;
ALTER TABLE "purchase_order_items" ADD COLUMN "source_b2b_request_item_id" TEXT;
CREATE INDEX "purchase_orders_source_b2b_request_id_idx" ON "purchase_orders"("source_b2b_request_id");
CREATE UNIQUE INDEX "purchase_orders_entity_id_source_request_key_key" ON "purchase_orders"("entity_id","source_request_key");
CREATE INDEX "purchase_order_items_source_b2b_request_item_id_idx" ON "purchase_order_items"("source_b2b_request_item_id");
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_source_b2b_request_id_fkey" FOREIGN KEY ("source_b2b_request_id") REFERENCES "b2b_purchase_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_source_b2b_request_item_id_fkey" FOREIGN KEY ("source_b2b_request_item_id") REFERENCES "b2b_request_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_source_request_pair" CHECK (("source_b2b_request_id" IS NULL AND "source_request_key" IS NULL AND "source_payload_hash" IS NULL) OR ("source_b2b_request_id" IS NOT NULL AND "source_request_key" IS NOT NULL AND "source_payload_hash" IS NOT NULL));

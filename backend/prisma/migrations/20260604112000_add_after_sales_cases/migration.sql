CREATE TABLE "after_sales_cases" (
  "id" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "customer_id" TEXT,
  "original_sales_order_id" TEXT,
  "case_no" TEXT NOT NULL,
  "case_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reason_category" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'customer_service',
  "currency" TEXT NOT NULL DEFAULT 'TWD',
  "payment_status" TEXT NOT NULL DEFAULT 'not_required',
  "payment_amount_original" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "payment_link_url" TEXT,
  "payment_requested_at" TIMESTAMP(3),
  "paid_at" TIMESTAMP(3),
  "accounting_received_at" TIMESTAMP(3),
  "invoice_id" TEXT,
  "invoice_number" TEXT,
  "invoice_issued_at" TIMESTAMP(3),
  "warehouse_received_at" TIMESTAMP(3),
  "shipped_at" TIMESTAMP(3),
  "tracking_no" TEXT,
  "notes" TEXT,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "after_sales_cases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "after_sales_case_items" (
  "id" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "after_sales_case_id" TEXT NOT NULL,
  "product_id" TEXT,
  "sku" TEXT,
  "item_name" TEXT NOT NULL,
  "quantity" DECIMAL(18,2) NOT NULL DEFAULT 1,
  "unit_price_original" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "payment_required" BOOLEAN NOT NULL DEFAULT false,
  "payment_amount_original" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "notes" TEXT,
  "sort_order" INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT "after_sales_case_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "after_sales_cases_entity_id_case_no_key"
ON "after_sales_cases"("entity_id", "case_no");

CREATE INDEX "after_sales_cases_entity_id_status_idx"
ON "after_sales_cases"("entity_id", "status");

CREATE INDEX "after_sales_cases_entity_id_reason_category_idx"
ON "after_sales_cases"("entity_id", "reason_category");

CREATE INDEX "after_sales_cases_customer_id_idx"
ON "after_sales_cases"("customer_id");

CREATE INDEX "after_sales_case_items_entity_id_idx"
ON "after_sales_case_items"("entity_id");

CREATE INDEX "after_sales_case_items_after_sales_case_id_idx"
ON "after_sales_case_items"("after_sales_case_id");

CREATE INDEX "after_sales_case_items_product_id_idx"
ON "after_sales_case_items"("product_id");

ALTER TABLE "after_sales_cases"
ADD CONSTRAINT "after_sales_cases_entity_id_fkey"
FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "after_sales_cases"
ADD CONSTRAINT "after_sales_cases_customer_id_fkey"
FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "after_sales_cases"
ADD CONSTRAINT "after_sales_cases_original_sales_order_id_fkey"
FOREIGN KEY ("original_sales_order_id") REFERENCES "sales_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "after_sales_case_items"
ADD CONSTRAINT "after_sales_case_items_entity_id_fkey"
FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "after_sales_case_items"
ADD CONSTRAINT "after_sales_case_items_after_sales_case_id_fkey"
FOREIGN KEY ("after_sales_case_id") REFERENCES "after_sales_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "after_sales_case_items"
ADD CONSTRAINT "after_sales_case_items_product_id_fkey"
FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

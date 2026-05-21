-- CreateTable
CREATE TABLE "sales_quotations" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "quotation_no" TEXT NOT NULL,
    "quotation_date" TIMESTAMP(3) NOT NULL,
    "valid_until" TIMESTAMP(3),
    "owner_name" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'TWD',
    "payment_terms" TEXT,
    "delivery_terms" TEXT,
    "reference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "subtotal_original" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discount_amount_original" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax_amount_original" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total_amount_original" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "internal_note" TEXT,
    "created_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_quotation_items" (
    "id" TEXT NOT NULL,
    "quotation_id" TEXT NOT NULL,
    "product_id" TEXT,
    "item_name" TEXT NOT NULL,
    "item_spec" TEXT,
    "quantity" DECIMAL(18,2) NOT NULL,
    "unit_price_original" DECIMAL(18,2) NOT NULL,
    "discount_original" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax_rate" DECIMAL(8,4) NOT NULL DEFAULT 5,
    "tax_amount_original" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "line_total_original" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sales_quotation_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_quotations_entity_id_quotation_date_idx" ON "sales_quotations"("entity_id", "quotation_date");

-- CreateIndex
CREATE INDEX "sales_quotations_entity_id_status_idx" ON "sales_quotations"("entity_id", "status");

-- CreateIndex
CREATE INDEX "sales_quotations_customer_id_idx" ON "sales_quotations"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_quotations_entity_id_quotation_no_key" ON "sales_quotations"("entity_id", "quotation_no");

-- CreateIndex
CREATE INDEX "sales_quotation_items_quotation_id_idx" ON "sales_quotation_items"("quotation_id");

-- CreateIndex
CREATE INDEX "sales_quotation_items_product_id_idx" ON "sales_quotation_items"("product_id");

-- AddForeignKey
ALTER TABLE "sales_quotations" ADD CONSTRAINT "sales_quotations_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_quotations" ADD CONSTRAINT "sales_quotations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_quotation_items" ADD CONSTRAINT "sales_quotation_items_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "sales_quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_quotation_items" ADD CONSTRAINT "sales_quotation_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

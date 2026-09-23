-- CreateTable
CREATE TABLE "b2b_accounts" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "account_type" TEXT NOT NULL DEFAULT 'CUSTOMER',
    "customer_id" TEXT,
    "vendor_id" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "b2b_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "b2b_sessions" (
    "token_hash" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,

    CONSTRAINT "b2b_sessions_pkey" PRIMARY KEY ("token_hash")
);

-- CreateTable
CREATE TABLE "b2b_catalog_items" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "unit_price" DECIMAL(18,2) NOT NULL,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "updated_by" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "b2b_catalog_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "b2b_customer_prices" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "unit_price" DECIMAL(18,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "valid_until" TIMESTAMPTZ,
    "updated_by" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "b2b_customer_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "b2b_purchase_requests" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "source_hash" TEXT NOT NULL,
    "sales_order_id" TEXT,
    "request_number" TEXT NOT NULL,
    "customer_po_number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending_stock_review',
    "currency" TEXT NOT NULL DEFAULT 'TWD',
    "subtotal" DECIMAL(18,2) NOT NULL,
    "tax" DECIMAL(18,2) NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMPTZ,
    "reviewed_by" TEXT,
    "review_note" TEXT,
    "delivery_date" DATE,

    CONSTRAINT "b2b_purchase_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "b2b_request_items" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "confirmed_quantity" INTEGER,
    "unit_price" DECIMAL(18,2) NOT NULL,
    "line_total" DECIMAL(18,2) NOT NULL,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "b2b_request_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "b2b_accounts_customer_id_idx" ON "b2b_accounts"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "b2b_accounts_entity_id_email_key" ON "b2b_accounts"("entity_id", "email");

-- CreateIndex
CREATE INDEX "b2b_sessions_account_id_idx" ON "b2b_sessions"("account_id");

-- CreateIndex
CREATE INDEX "b2b_sessions_expires_at_idx" ON "b2b_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "b2b_catalog_items_entity_id_product_id_key" ON "b2b_catalog_items"("entity_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "b2b_customer_prices_entity_id_customer_id_product_id_key" ON "b2b_customer_prices"("entity_id", "customer_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "b2b_purchase_requests_sales_order_id_key" ON "b2b_purchase_requests"("sales_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "b2b_purchase_requests_request_number_key" ON "b2b_purchase_requests"("request_number");

-- CreateIndex
CREATE INDEX "b2b_purchase_requests_entity_id_status_created_at_idx" ON "b2b_purchase_requests"("entity_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "b2b_purchase_requests_entity_id_customer_id_request_id_key" ON "b2b_purchase_requests"("entity_id", "customer_id", "request_id");

-- CreateIndex
CREATE UNIQUE INDEX "b2b_request_items_request_id_product_id_key" ON "b2b_request_items"("request_id", "product_id");

-- AddForeignKey
ALTER TABLE "b2b_accounts" ADD CONSTRAINT "b2b_accounts_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "b2b_accounts" ADD CONSTRAINT "b2b_accounts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "b2b_accounts" ADD CONSTRAINT "b2b_accounts_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "b2b_sessions" ADD CONSTRAINT "b2b_sessions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "b2b_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "b2b_catalog_items" ADD CONSTRAINT "b2b_catalog_items_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "b2b_catalog_items" ADD CONSTRAINT "b2b_catalog_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "b2b_customer_prices" ADD CONSTRAINT "b2b_customer_prices_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "b2b_customer_prices" ADD CONSTRAINT "b2b_customer_prices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "b2b_customer_prices" ADD CONSTRAINT "b2b_customer_prices_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "b2b_purchase_requests" ADD CONSTRAINT "b2b_purchase_requests_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "b2b_purchase_requests" ADD CONSTRAINT "b2b_purchase_requests_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "b2b_purchase_requests" ADD CONSTRAINT "b2b_purchase_requests_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "b2b_purchase_requests" ADD CONSTRAINT "b2b_purchase_requests_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "b2b_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "b2b_request_items" ADD CONSTRAINT "b2b_request_items_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "b2b_purchase_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Partner roles cannot cross customer/supplier data boundaries.
ALTER TABLE "b2b_accounts" ADD CONSTRAINT "b2b_accounts_partner_xor" CHECK (
  (account_type = 'CUSTOMER' AND customer_id IS NOT NULL AND vendor_id IS NULL) OR
  (account_type = 'SUPPLIER' AND vendor_id IS NOT NULL AND customer_id IS NULL)
);
ALTER TABLE "b2b_catalog_items" ADD CONSTRAINT "b2b_catalog_price_nonnegative" CHECK (unit_price >= 0);
ALTER TABLE "b2b_customer_prices" ADD CONSTRAINT "b2b_customer_price_nonnegative" CHECK (unit_price >= 0);
ALTER TABLE "b2b_request_items" ADD CONSTRAINT "b2b_request_quantity_valid" CHECK (quantity > 0 AND (confirmed_quantity IS NULL OR (confirmed_quantity >= 0 AND confirmed_quantity <= quantity)));
ALTER TABLE "b2b_request_items" ADD CONSTRAINT "b2b_request_price_nonnegative" CHECK (unit_price >= 0 AND line_total >= 0);
ALTER TABLE "b2b_purchase_requests" ADD CONSTRAINT "b2b_request_status_valid" CHECK (status IN ('pending_stock_review','stock_confirmed','needs_adjustment','order_confirmed'));

-- CreateTable
CREATE TABLE "after_sales_stock_units" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "inventory_serial_id" TEXT,
    "product_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "unit_label" TEXT NOT NULL,
    "serial_number" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUALIFIED',
    "qualification" JSONB NOT NULL,
    "source_item_id" TEXT,
    "qualified_by_id" TEXT NOT NULL,
    "qualified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "after_sales_stock_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "after_sales_stock_reservations" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "active_key" TEXT,
    "request_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RESERVED',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "actor_id" TEXT NOT NULL,
    "reserve_transaction_id" TEXT NOT NULL,
    "release_transaction_id" TEXT,
    "out_transaction_id" TEXT,
    "external_status" TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
    "external_reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "after_sales_stock_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "after_sales_stock_units_source_item_id_key" ON "after_sales_stock_units"("source_item_id");

-- CreateIndex
CREATE INDEX "after_sales_stock_units_entity_id_status_idx" ON "after_sales_stock_units"("entity_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "after_sales_stock_units_entity_id_unit_label_key" ON "after_sales_stock_units"("entity_id", "unit_label");

-- CreateIndex
CREATE UNIQUE INDEX "after_sales_stock_reservations_active_key_key" ON "after_sales_stock_reservations"("active_key");

-- CreateIndex
CREATE UNIQUE INDEX "after_sales_stock_reservations_reserve_transaction_id_key" ON "after_sales_stock_reservations"("reserve_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "after_sales_stock_reservations_release_transaction_id_key" ON "after_sales_stock_reservations"("release_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "after_sales_stock_reservations_out_transaction_id_key" ON "after_sales_stock_reservations"("out_transaction_id");

-- CreateIndex
CREATE INDEX "after_sales_stock_reservations_entity_id_item_id_status_idx" ON "after_sales_stock_reservations"("entity_id", "item_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "after_sales_stock_reservations_entity_id_request_id_key" ON "after_sales_stock_reservations"("entity_id", "request_id");

-- AddForeignKey
ALTER TABLE "after_sales_stock_units" ADD CONSTRAINT "after_sales_stock_units_inventory_serial_id_fkey" FOREIGN KEY ("inventory_serial_id") REFERENCES "inventory_serial_numbers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "after_sales_stock_reservations" ADD CONSTRAINT "after_sales_stock_reservations_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "mailroom_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "after_sales_stock_reservations" ADD CONSTRAINT "after_sales_stock_reservations_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "after_sales_stock_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "after_sales_stock_reservations" ADD CONSTRAINT "after_sales_stock_reservations_reserve_transaction_id_fkey" FOREIGN KEY ("reserve_transaction_id") REFERENCES "inventory_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "after_sales_stock_reservations" ADD CONSTRAINT "after_sales_stock_reservations_release_transaction_id_fkey" FOREIGN KEY ("release_transaction_id") REFERENCES "inventory_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "after_sales_stock_reservations" ADD CONSTRAINT "after_sales_stock_reservations_out_transaction_id_fkey" FOREIGN KEY ("out_transaction_id") REFERENCES "inventory_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


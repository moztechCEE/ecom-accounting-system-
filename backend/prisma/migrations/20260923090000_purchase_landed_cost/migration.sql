CREATE TABLE "purchase_landed_costs" (
    "id" TEXT NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "freight_currency" TEXT NOT NULL,
    "rate_per_kg_original" DECIMAL(18,6) NOT NULL,
    "fx_rate_to_base" DECIMAL(18,6) NOT NULL,
    "total_chargeable_weight_kg" DECIMAL(18,3) NOT NULL,
    "freight_original" DECIMAL(18,2) NOT NULL,
    "freight_base" DECIMAL(18,2) NOT NULL,
    "goods_base" DECIMAL(18,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'estimated',
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT NOT NULL,
    "applied_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "purchase_landed_costs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "purchase_landed_costs_amount_check" CHECK (
      "rate_per_kg_original" >= 0 AND "fx_rate_to_base" > 0
      AND "total_chargeable_weight_kg" >= 0 AND "freight_original" >= 0
      AND "freight_base" >= 0 AND "goods_base" >= 0
    ),
    CONSTRAINT "purchase_landed_costs_status_check" CHECK ("status" IN ('estimated', 'applied'))
);

CREATE TABLE "purchase_landed_cost_lines" (
    "id" TEXT NOT NULL,
    "landed_cost_id" TEXT NOT NULL,
    "purchase_order_item_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "qty" DECIMAL(18,2) NOT NULL,
    "chargeable_weight_kg" DECIMAL(18,3) NOT NULL,
    "allocated_freight_base" DECIMAL(18,2) NOT NULL,
    "landed_unit_cost_base" DECIMAL(18,6) NOT NULL,
    CONSTRAINT "purchase_landed_cost_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "purchase_landed_cost_lines_amount_check" CHECK (
      "qty" > 0 AND "chargeable_weight_kg" >= 0
      AND "allocated_freight_base" >= 0 AND "landed_unit_cost_base" >= 0
    )
);

CREATE UNIQUE INDEX "purchase_landed_costs_purchase_order_id_key" ON "purchase_landed_costs"("purchase_order_id");
CREATE INDEX "purchase_landed_costs_entity_id_status_idx" ON "purchase_landed_costs"("entity_id", "status");
CREATE UNIQUE INDEX "purchase_landed_cost_lines_purchase_order_item_id_key" ON "purchase_landed_cost_lines"("purchase_order_item_id");
CREATE INDEX "purchase_landed_cost_lines_landed_cost_id_idx" ON "purchase_landed_cost_lines"("landed_cost_id");

ALTER TABLE "purchase_landed_costs" ADD CONSTRAINT "purchase_landed_costs_purchase_order_id_fkey"
  FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_landed_cost_lines" ADD CONSTRAINT "purchase_landed_cost_lines_landed_cost_id_fkey"
  FOREIGN KEY ("landed_cost_id") REFERENCES "purchase_landed_costs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_landed_cost_lines" ADD CONSTRAINT "purchase_landed_cost_lines_purchase_order_item_id_fkey"
  FOREIGN KEY ("purchase_order_item_id") REFERENCES "purchase_order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

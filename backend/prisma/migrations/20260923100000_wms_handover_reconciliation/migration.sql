CREATE TABLE "wms_handover_inbox" (
 "id" TEXT PRIMARY KEY,
 "entity_id" TEXT NOT NULL REFERENCES "entities"("id") ON DELETE RESTRICT,
 "event_id" TEXT NOT NULL,
 "wms_shipment_id" TEXT NOT NULL,
 "shipment_id" TEXT NOT NULL UNIQUE REFERENCES "shipments"("id") ON DELETE RESTRICT,
 "warehouse_id" TEXT NOT NULL REFERENCES "warehouses"("id") ON DELETE RESTRICT,
 "sales_order_id" TEXT NOT NULL REFERENCES "sales_orders"("id") ON DELETE RESTRICT,
 "native_intake_id" INTEGER NOT NULL CHECK ("native_intake_id">0),
 "wms_order_id" INTEGER NOT NULL CHECK ("wms_order_id">0),
 "source_hash" TEXT NOT NULL CHECK ("source_hash" ~ '^[a-f0-9]{64}$'),
 "body_hash" TEXT NOT NULL CHECK ("body_hash" ~ '^[a-f0-9]{64}$'),
 "payload" JSONB NOT NULL,
 "occurred_at" TIMESTAMPTZ NOT NULL,
 "received_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE("entity_id","event_id"), UNIQUE("entity_id","wms_shipment_id")
);
CREATE INDEX "wms_handover_inbox_entity_id_received_at_idx" ON "wms_handover_inbox"("entity_id","received_at");
CREATE TABLE "shipment_lines" (
 "id" TEXT PRIMARY KEY,
 "entity_id" TEXT NOT NULL REFERENCES "entities"("id") ON DELETE RESTRICT,
 "shipment_line_id" TEXT NOT NULL,
 "inbox_id" TEXT NOT NULL REFERENCES "wms_handover_inbox"("id") ON DELETE RESTRICT,
 "shipment_id" TEXT NOT NULL REFERENCES "shipments"("id") ON DELETE RESTRICT,
 "sales_order_line_id" TEXT NOT NULL REFERENCES "sales_order_items"("id") ON DELETE RESTRICT,
 "product_id" TEXT NOT NULL REFERENCES "products"("id") ON DELETE RESTRICT,
 "sku" TEXT NOT NULL,
 "product_name" TEXT NOT NULL,
 "quantity" DECIMAL(18,2) NOT NULL CHECK ("quantity">0 AND "quantity"=trunc("quantity")),
 "packages" JSONB NOT NULL CHECK (jsonb_typeof("packages")='array' AND jsonb_array_length("packages")>0),
 UNIQUE("entity_id","shipment_line_id")
);
CREATE INDEX "shipment_lines_sales_order_line_id_idx" ON "shipment_lines"("sales_order_line_id");
CREATE INDEX "shipment_lines_inbox_id_idx" ON "shipment_lines"("inbox_id");
CREATE TABLE "wms_shipment_postings" (
 "id" TEXT PRIMARY KEY,
 "shipment_line_id" TEXT NOT NULL UNIQUE REFERENCES "shipment_lines"("id") ON DELETE RESTRICT,
 "quantity" DECIMAL(18,2) NOT NULL CHECK ("quantity">0 AND "quantity"=trunc("quantity")),
 "unit_cost_base" DECIMAL(18,4) NOT NULL CHECK ("unit_cost_base">=0),
 "total_cost_base" DECIMAL(18,2) NOT NULL CHECK ("total_cost_base">=0),
 "inventory_out_id" TEXT NOT NULL UNIQUE REFERENCES "inventory_transactions"("id") ON DELETE RESTRICT,
 "inventory_release_id" TEXT NOT NULL UNIQUE REFERENCES "inventory_transactions"("id") ON DELETE RESTRICT,
 "posted_by" TEXT NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
 "posted_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
 "note" TEXT
);

-- Evidence and posting receipts are append-only. Corrections require an explicit future reversal workflow.
CREATE FUNCTION reject_wms_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'WMS evidence and posting receipts are immutable' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER wms_handover_inbox_immutable BEFORE UPDATE OR DELETE ON wms_handover_inbox FOR EACH ROW EXECUTE FUNCTION reject_wms_evidence_mutation();
CREATE TRIGGER shipment_lines_immutable BEFORE UPDATE OR DELETE ON shipment_lines FOR EACH ROW EXECUTE FUNCTION reject_wms_evidence_mutation();
CREATE TRIGGER wms_shipment_postings_immutable BEFORE UPDATE OR DELETE ON wms_shipment_postings FOR EACH ROW EXECUTE FUNCTION reject_wms_evidence_mutation();

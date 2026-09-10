CREATE TABLE "wms_dispatch_intents" (
 "entity_id" TEXT NOT NULL,
 "sales_order_id" TEXT NOT NULL REFERENCES "sales_orders"("id") ON DELETE RESTRICT,
 "request_id" TEXT NOT NULL,
 "created_by" TEXT NOT NULL,
 "payload_hash" TEXT NOT NULL,
 "payload" JSONB NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'prepared' CHECK ("status" IN ('prepared','unknown','acknowledged')),
 "response" JSONB,
 "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
 "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY("entity_id","sales_order_id"),
 UNIQUE("entity_id","request_id")
);

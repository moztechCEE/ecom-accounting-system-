CREATE TABLE "mailroom_outbound_orders" (
  "id" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "source_case_id" TEXT NOT NULL,
  "source_number" TEXT NOT NULL,
  "case_type" TEXT NOT NULL,
  "source_version" TEXT NOT NULL,
  "source_snapshot" JSONB NOT NULL,
  "items" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING_PICK',
  "version" INTEGER NOT NULL DEFAULT 1,
  "location" TEXT,
  "custodian_id" TEXT,
  "next_user_id" TEXT,
  "prepared_by_id" TEXT,
  "stock_request_id" TEXT,
  "outbound_shipment" JSONB,
  "created_by_id" TEXT NOT NULL,
  "request_id" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mailroom_outbound_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mailroom_outbound_type" CHECK ("case_type" IN ('RESHIPMENT','PRIVATE_PURCHASE','EXCHANGE_RETURN')),
  CONSTRAINT "mailroom_outbound_status" CHECK ("status" IN ('PENDING_PICK','WAITING_MAILROOM_ACCEPTANCE','READY_FOR_DISPATCH','DISPATCHED','CANCELLED')),
  CONSTRAINT "mailroom_outbound_version" CHECK ("version" > 0)
);
CREATE TABLE "mailroom_outbound_actions" (
  "id" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "request_id" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "from_status" TEXT,
  "to_status" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mailroom_outbound_actions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mailroom_outbound_actions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "mailroom_outbound_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "mailroom_outbound_orders_entity_id_created_by_id_request_id_key" ON "mailroom_outbound_orders"("entity_id","created_by_id","request_id");
CREATE INDEX "mailroom_outbound_orders_entity_id_status_created_at_idx" ON "mailroom_outbound_orders"("entity_id","status","created_at");
CREATE INDEX "mailroom_outbound_orders_entity_id_source_case_id_idx" ON "mailroom_outbound_orders"("entity_id","source_case_id");
CREATE INDEX "mailroom_outbound_orders_next_user_id_status_idx" ON "mailroom_outbound_orders"("next_user_id","status");
CREATE UNIQUE INDEX "mailroom_outbound_actions_entity_id_actor_id_request_id_key" ON "mailroom_outbound_actions"("entity_id","actor_id","request_id");
CREATE UNIQUE INDEX "mailroom_outbound_actions_order_id_version_key" ON "mailroom_outbound_actions"("order_id","version");

ALTER TABLE "sales_orders"
ADD COLUMN "timeout_reconciliation_status" TEXT,
ADD COLUMN "timeout_reconciliation_note" TEXT,
ADD COLUMN "payment_link_url" TEXT,
ADD COLUMN "payment_link_last_sent_at" TIMESTAMP(3),
ADD COLUMN "payment_link_resend_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "returned_to_accounting_at" TIMESTAMP(3),
ADD COLUMN "timeout_reconciliation_updated_at" TIMESTAMP(3);

CREATE INDEX "sales_orders_entity_id_timeout_reconciliation_status_idx"
ON "sales_orders"("entity_id", "timeout_reconciliation_status");

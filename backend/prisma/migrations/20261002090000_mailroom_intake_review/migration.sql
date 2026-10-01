-- Physical inspection and the responsible customer-service staff are separate from refunds.
ALTER TABLE "mailroom_receipts" ADD COLUMN "customer_service_user_id" TEXT;
ALTER TABLE "mailroom_items" ADD COLUMN "return_inspection" JSONB;

-- Additive documents and immutable operation receipts only. No existing rows change.
CREATE TABLE "mailroom_precheck_documents" (
  "id" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "item_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "identity_hash" TEXT NOT NULL,
  "template" JSONB,
  "data" JSONB NOT NULL,
  "saved_by_id" TEXT NOT NULL,
  "saved_by_name" TEXT NOT NULL,
  "saved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submitted_by_id" TEXT,
  "submitted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mailroom_precheck_documents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mailroom_precheck_doc_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "mailroom_precheck_doc_status_check" CHECK ("status" IN ('DRAFT','READY','SUBMITTED')),
  CONSTRAINT "mailroom_precheck_doc_item_fkey" FOREIGN KEY ("item_id") REFERENCES "mailroom_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "mailroom_precheck_doc_item_key" ON "mailroom_precheck_documents"("entity_id","item_id");
CREATE INDEX "mailroom_precheck_doc_stage_idx" ON "mailroom_precheck_documents"("entity_id","status","updated_at");

CREATE TABLE "mailroom_precheck_batches" (
  "id" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "request_id" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "result" JSONB NOT NULL,
  "recipient_snapshot" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mailroom_precheck_batches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mailroom_precheck_batch_operation_check" CHECK ("operation" IN ('START','HANDOFF'))
);
CREATE UNIQUE INDEX "mailroom_precheck_batch_key" ON "mailroom_precheck_batches"("entity_id","actor_id","request_id");
CREATE UNIQUE INDEX "mailroom_precheck_batch_company_key" ON "mailroom_precheck_batches"("id","entity_id");
CREATE UNIQUE INDEX "mailroom_precheck_batch_owner_key" ON "mailroom_precheck_batches"("id","entity_id","actor_id");

CREATE TABLE "mailroom_precheck_requests" (
  "id" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "request_id" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "item_id" TEXT NOT NULL,
  "batch_id" TEXT,
  "result" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mailroom_precheck_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mailroom_precheck_request_operation_check" CHECK ("operation" IN ('START','SAVE','HANDOFF')),
  CONSTRAINT "mailroom_precheck_request_item_fkey" FOREIGN KEY ("item_id") REFERENCES "mailroom_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "mailroom_precheck_request_batch_fkey" FOREIGN KEY ("batch_id","entity_id","actor_id") REFERENCES "mailroom_precheck_batches"("id","entity_id","actor_id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "mailroom_precheck_request_key" ON "mailroom_precheck_requests"("entity_id","actor_id","request_id");
CREATE INDEX "mailroom_precheck_request_item_idx" ON "mailroom_precheck_requests"("entity_id","item_id","created_at");

CREATE TABLE "mailroom_precheck_batch_recipients" (
  "id" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "batch_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "notification_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mailroom_precheck_batch_recipients_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mailroom_precheck_recipient_batch_fkey" FOREIGN KEY ("batch_id","entity_id") REFERENCES "mailroom_precheck_batches"("id","entity_id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "mailroom_precheck_recipient_key" ON "mailroom_precheck_batch_recipients"("batch_id","user_id");
CREATE UNIQUE INDEX "mailroom_precheck_recipient_notification_key" ON "mailroom_precheck_batch_recipients"("notification_id");

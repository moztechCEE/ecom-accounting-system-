CREATE TABLE "mailroom_product_mismatch_facts" (
  "id" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "item_id" TEXT NOT NULL,
  "receipt_id" TEXT NOT NULL,
  "source_case_id" TEXT NOT NULL,
  "identity_hash" TEXT NOT NULL,
  "proof_id" TEXT NOT NULL,
  "source_version" TEXT NOT NULL,
  "case_brand" TEXT NOT NULL,
  "first_review_erp_actor_id" TEXT,
  "reviewed_by_erp_actor_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "proof_snapshot" JSONB NOT NULL,
  "voided_at" TIMESTAMP(3),
  "void_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mailroom_product_mismatch_facts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mailroom_product_mismatch_status" CHECK ("status" IN ('ACTIVE','VOID')),
  CONSTRAINT "mailroom_product_mismatch_hash" CHECK ("identity_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "mailroom_product_mismatch_brand" CHECK ("case_brand" IN ('MOZTECH','BONSON','WANBO'))
);
CREATE UNIQUE INDEX "mailroom_product_mismatch_identity_key" ON "mailroom_product_mismatch_facts"("entity_id","item_id","identity_hash");
CREATE INDEX "mailroom_product_mismatch_source_status_idx" ON "mailroom_product_mismatch_facts"("entity_id","source_case_id","status");
CREATE INDEX "mailroom_product_mismatch_first_reviewer_idx" ON "mailroom_product_mismatch_facts"("first_review_erp_actor_id","status");

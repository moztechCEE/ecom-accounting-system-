-- No source-case, inventory, payment or invoice rows are modified.
CREATE TABLE "after_sales_brand_settings" (
  "entity_id" TEXT NOT NULL REFERENCES "entities"("id") ON DELETE RESTRICT,
  "code" TEXT NOT NULL,
  "version" INTEGER NOT NULL CHECK ("version" > 0),
  "data" JSONB NOT NULL,
  "updated_by" TEXT NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("entity_id", "code")
);
CREATE TABLE "after_sales_quote_drafts" (
  "id" TEXT PRIMARY KEY,
  "entity_id" TEXT NOT NULL REFERENCES "entities"("id") ON DELETE RESTRICT,
  "request_key" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "data" JSONB NOT NULL,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("entity_id", "request_key")
);
CREATE INDEX "after_sales_quote_drafts_entity_created_idx" ON "after_sales_quote_drafts"("entity_id", "created_at");
CREATE TABLE "after_sales_case_brand_bindings" (
  "entity_id" TEXT NOT NULL,
  "source_case_id" TEXT NOT NULL,
  "brand_code" TEXT NOT NULL,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("entity_id", "source_case_id"),
  FOREIGN KEY ("entity_id", "brand_code") REFERENCES "after_sales_brand_settings"("entity_id", "code") ON DELETE RESTRICT
);

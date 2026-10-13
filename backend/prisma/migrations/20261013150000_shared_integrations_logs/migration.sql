ALTER TABLE "audit_logs" ADD COLUMN "company_id" TEXT, ADD COLUMN "brand" TEXT, ADD COLUMN "correlation_id" TEXT;
CREATE INDEX "audit_logs_company_id_created_at_id_idx" ON "audit_logs" ("company_id", "created_at", "id");
CREATE TABLE "integration_connections" ("id" TEXT PRIMARY KEY, "entity_id" TEXT NOT NULL REFERENCES "entities"("id") ON DELETE RESTRICT, "category" TEXT NOT NULL, "provider" TEXT NOT NULL, "brand" TEXT NOT NULL DEFAULT '', "account_id" TEXT NOT NULL, "display_name" TEXT NOT NULL, "environment" TEXT NOT NULL, "credential_ref" TEXT, "metadata" JSONB NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, "enabled" BOOLEAN NOT NULL DEFAULT true, "verification_status" TEXT NOT NULL DEFAULT 'UNVERIFIED', "verified_at" TIMESTAMP(3), "verification_code" TEXT, "updated_by" TEXT NOT NULL, "updated_at" TIMESTAMP(3) NOT NULL);
CREATE UNIQUE INDEX "integration_connections_entity_id_provider_brand_account_id_environment_key" ON "integration_connections" ("entity_id", "provider", "brand", "account_id", "environment");
CREATE INDEX "integration_connections_entity_id_category_idx" ON "integration_connections" ("entity_id", "category");
CREATE TABLE "operation_interactions" ("id" TEXT PRIMARY KEY, "entity_id" TEXT NOT NULL REFERENCES "entities"("id") ON DELETE RESTRICT, "actor_id" TEXT NOT NULL, "actor_name" TEXT NOT NULL, "actor_roles" JSONB NOT NULL, "action_id" TEXT NOT NULL, "workbench" TEXT NOT NULL, "brand" TEXT, "record_id" TEXT, "request_id" TEXT, "outcome" TEXT NOT NULL, "request_hash" TEXT NOT NULL, "occurred_at" TIMESTAMP(3) NOT NULL, "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "operation_interactions_entity_id_occurred_at_id_idx" ON "operation_interactions" ("entity_id", "occurred_at", "id");
CREATE INDEX "operation_interactions_entity_id_request_id_idx" ON "operation_interactions" ("entity_id", "request_id");
CREATE TABLE "operation_log_archives" ("id" TEXT PRIMARY KEY, "entity_id" TEXT NOT NULL REFERENCES "entities"("id") ON DELETE RESTRICT, "created_by" TEXT NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "manifest" JSONB NOT NULL, "content" BYTEA NOT NULL);
CREATE INDEX "operation_log_archives_entity_id_created_at_idx" ON "operation_log_archives" ("entity_id", "created_at");
INSERT INTO "permissions" (id, resource, action, description, created_at) VALUES
('integration_settings-read','integration_settings','read','查看公司串接設定',CURRENT_TIMESTAMP),
('integration_settings-update','integration_settings','update','維護公司串接設定',CURRENT_TIMESTAMP),
('operation_logs-read','operation_logs','read','查看公司操作日誌',CURRENT_TIMESTAMP),
('operation_logs-export','operation_logs','export','匯出公司操作日誌封存包',CURRENT_TIMESTAMP)
ON CONFLICT (resource, action) DO NOTHING;

ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_category" CHECK ("category" IN ('LINE','COMMERCE','ADS','INVOICE','AFTER_SALES')), ADD CONSTRAINT "integration_connections_brand" CHECK ("brand" IN ('','MOZTECH','BONSON')), ADD CONSTRAINT "integration_connections_environment" CHECK ("environment" IN ('DEV','STAGE','PRODUCTION')), ADD CONSTRAINT "integration_connections_verification" CHECK ("verification_status" IN ('UNVERIFIED','VERIFIED','FAILED')), ADD CONSTRAINT "integration_connections_version" CHECK ("version" > 0);
ALTER TABLE "operation_interactions" ADD CONSTRAINT "operation_interactions_outcome" CHECK ("outcome" IN ('INTENT','CANCELLED','VALIDATION_BLOCKED'));

CREATE INDEX "mailroom_actions_entity_id_created_at_id_idx" ON "mailroom_actions" ("entity_id", "created_at", "id");
CREATE INDEX "mailroom_deliveries_entity_id_created_at_id_idx" ON "mailroom_deliveries" ("entity_id", "created_at", "id");

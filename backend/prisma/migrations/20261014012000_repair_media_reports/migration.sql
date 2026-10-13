-- Reviewed DEV integration: central schema/migration owner reviews and applies in DEV.
-- Generated from the supplied Prisma fragment; scoped FKs and integrity guards below.
-- CreateTable
CREATE TABLE "repair_media_assets" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "document_revision" INTEGER NOT NULL,
    "phase" TEXT NOT NULL,
    "check_key" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "bucket" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "generation" TEXT,
    "sha256" TEXT,
    "content_type" TEXT NOT NULL,
    "size_bytes" BIGINT,
    "bindings" JSONB NOT NULL DEFAULT '[]',
    "uploaded_by_id" TEXT NOT NULL,
    "finalized_at" TIMESTAMP(3),
    "revoked_by_id" TEXT,
    "revoked_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repair_media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repair_customer_reports" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "source_case_id" TEXT NOT NULL,
    "source_brand" TEXT NOT NULL,
    "verified_customer_id" TEXT NOT NULL,
    "inspection_revision" INTEGER NOT NULL,
    "report_revision" INTEGER,
    "plan_hash" TEXT NOT NULL,
    "proposal_hash" TEXT NOT NULL,
    "item_identity_hash" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "quote_revision" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "content_hash" TEXT NOT NULL,
    "media_ids" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "published_by_id" TEXT NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_by_id" TEXT,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "repair_customer_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repair_evidence_operations" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repair_evidence_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "repair_media_assets_object_key_key" ON "repair_media_assets"("object_key");

-- CreateIndex
CREATE INDEX "repair_media_assets_entity_id_item_id_status_idx" ON "repair_media_assets"("entity_id", "item_id", "status");

-- CreateIndex
CREATE INDEX "repair_customer_reports_entity_id_item_id_status_idx" ON "repair_customer_reports"("entity_id", "item_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "repair_evidence_operations_entity_id_actor_id_request_id_key" ON "repair_evidence_operations"("entity_id", "actor_id", "request_id");


ALTER TABLE repair_media_assets
  ADD CONSTRAINT repair_media_entity_fk FOREIGN KEY(entity_id) REFERENCES entities(id) ON DELETE RESTRICT,
  ADD CONSTRAINT repair_media_item_fk FOREIGN KEY(item_id) REFERENCES mailroom_items(id) ON DELETE RESTRICT,
  ADD CONSTRAINT repair_media_kind_check CHECK(kind IN ('inspection','repair')),
  ADD CONSTRAINT repair_media_revision_check CHECK(document_revision > 0),
  ADD CONSTRAINT repair_media_phase_check CHECK(phase IN ('BEFORE','AFTER','DIAGNOSTIC')),
  ADD CONSTRAINT repair_media_status_check CHECK(status IN ('PENDING','FINALIZED','REVOKED')),
  ADD CONSTRAINT repair_media_bindings_check CHECK(jsonb_typeof(bindings)='array'),
  ADD CONSTRAINT repair_media_finalized_check CHECK(status <> 'FINALIZED' OR
    (generation IS NOT NULL AND sha256 IS NOT NULL AND size_bytes IS NOT NULL AND generation ~ '^[0-9]+$' AND sha256 ~ '^[a-f0-9]{64}$' AND finalized_at IS NOT NULL
     AND size_bytes > 0 AND size_bytes <= CASE WHEN content_type LIKE 'image/%' THEN 10485760 ELSE 134217728 END
     AND content_type IN ('image/jpeg','image/png','image/webp','video/mp4','video/webm','video/quicktime')));
ALTER TABLE repair_customer_reports
  ALTER COLUMN media_ids SET NOT NULL,
  ADD CONSTRAINT repair_report_entity_fk FOREIGN KEY(entity_id) REFERENCES entities(id) ON DELETE RESTRICT,
  ADD CONSTRAINT repair_report_item_fk FOREIGN KEY(item_id) REFERENCES mailroom_items(id) ON DELETE RESTRICT,
  ADD CONSTRAINT repair_report_revision_check CHECK(inspection_revision > 0 AND quote_revision > 0 AND (report_revision IS NULL OR report_revision > 0)),
  ADD CONSTRAINT repair_report_brand_check CHECK(source_brand IN ('MOZTECH','BONSON','WANBO')),
  ADD CONSTRAINT repair_report_hash_check CHECK(plan_hash ~ '^[a-f0-9]{64}$' AND proposal_hash ~ '^[a-f0-9]{64}$' AND item_identity_hash ~ '^[a-f0-9]{64}$' AND content_hash ~ '^[a-f0-9]{64}$' AND token_hash ~ '^[a-f0-9]{64}$' AND verified_customer_id ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT repair_report_status_check CHECK(status IN ('PUBLISHED','REVOKED')),
  ADD CONSTRAINT repair_report_expiry_check CHECK(expires_at > published_at),
  ADD CONSTRAINT repair_report_content_check CHECK(jsonb_typeof(content)='object' AND cardinality(media_ids)<=12 AND currency ~ '^[A-Z]{3}$');
ALTER TABLE repair_evidence_operations
  ADD CONSTRAINT repair_evidence_entity_fk FOREIGN KEY(entity_id) REFERENCES entities(id) ON DELETE RESTRICT,
  ADD CONSTRAINT repair_evidence_hash_check CHECK(request_hash ~ '^[a-f0-9]{64}$');
-- Entity/item pairing is revalidated from the locked native row by every writer;
-- these ID FKs ensure retention, without adding or changing native case rows.

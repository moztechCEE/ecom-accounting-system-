-- DRAFT ONLY: additive DEV print capability. No apply, device registration, or printing authorized by this file.
CREATE TABLE "mailroom_print_devices" (
  "id" TEXT NOT NULL, "entity_id" TEXT NOT NULL, "registered_by_id" TEXT NOT NULL, "name" TEXT NOT NULL,
  "pair_hash" TEXT, "pair_expires_at" TIMESTAMP(3), "token_hash" TEXT, "token_expires_at" TIMESTAMP(3), "paired_at" TIMESTAMP(3), "revoked_at" TIMESTAMP(3), "last_seen_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mailroom_print_devices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mailroom_print_device_name_check" CHECK (length("name") BETWEEN 1 AND 40),
  CONSTRAINT "mailroom_print_device_hash_check" CHECK (("pair_hash" IS NULL OR "pair_hash" ~ '^[a-f0-9]{64}$') AND ("token_hash" IS NULL OR "token_hash" ~ '^[a-f0-9]{64}$'))
);
CREATE UNIQUE INDEX "mailroom_print_device_company_key" ON "mailroom_print_devices"("id","entity_id");
CREATE UNIQUE INDEX "mailroom_print_device_pair_key" ON "mailroom_print_devices"("pair_hash");
CREATE UNIQUE INDEX "mailroom_print_device_token_key" ON "mailroom_print_devices"("token_hash");
CREATE INDEX "mailroom_print_device_owner_idx" ON "mailroom_print_devices"("entity_id","registered_by_id");

CREATE TABLE "mailroom_print_jobs" (
  "id" TEXT NOT NULL, "entity_id" TEXT NOT NULL, "created_by_id" TEXT NOT NULL, "device_id" TEXT NOT NULL,
  "request_id" TEXT NOT NULL, "request_hash" TEXT NOT NULL, "item_ids" TEXT[] NOT NULL, "item_set_hash" TEXT NOT NULL, "item_versions" JSONB NOT NULL,
  "pdf_bytes" BYTEA, "pdf_sha256" TEXT NOT NULL, "pdf_size" INTEGER NOT NULL, "pages" INTEGER NOT NULL, "profile" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED', "expires_at" TIMESTAMP(3) NOT NULL, "claimed_at" TIMESTAMP(3), "submitting_at" TIMESTAMP(3), "finished_at" TIMESTAMP(3),
  "cups_job_id" TEXT, "error_code" TEXT, "active_key" TEXT, "reprint_of" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mailroom_print_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mailroom_print_job_status_check" CHECK ("status" IN ('QUEUED','CLAIMED','SUBMITTING','SUBMITTED','FAILED','UNKNOWN')),
  CONSTRAINT "mailroom_print_job_profile_check" CHECK ("profile" = 'xp235b-50x30-v1'),
  CONSTRAINT "mailroom_print_job_size_check" CHECK ("pages" BETWEEN 1 AND 50 AND cardinality("item_ids") = "pages" AND "pdf_size" BETWEEN 5 AND 2097152 AND ("pdf_bytes" IS NULL OR octet_length("pdf_bytes") = "pdf_size")),
  CONSTRAINT "mailroom_print_job_hash_check" CHECK ("pdf_sha256" ~ '^[a-f0-9]{64}$' AND "request_hash" ~ '^[a-f0-9]{64}$' AND "item_set_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "mailroom_print_job_terminal_pdf_check" CHECK ("status" NOT IN ('SUBMITTED','FAILED','UNKNOWN') OR "pdf_bytes" IS NULL),
  CONSTRAINT "mailroom_print_job_cups_check" CHECK (("status" = 'SUBMITTED' AND "cups_job_id" IS NOT NULL AND "cups_job_id" ~ '^Xprinter_XP-235B-[1-9][0-9]*$' AND "error_code" IS NULL) OR ("status" <> 'SUBMITTED' AND "cups_job_id" IS NULL)),
  CONSTRAINT "mailroom_print_job_pending_pdf_check" CHECK ("status" NOT IN ('QUEUED','CLAIMED') OR "pdf_bytes" IS NOT NULL),
  CONSTRAINT "mailroom_print_job_active_check" CHECK (("status" NOT IN ('QUEUED','CLAIMED','SUBMITTING') OR "active_key" IS NOT NULL) AND ("status" NOT IN ('SUBMITTED','FAILED') OR "active_key" IS NULL)),
  CONSTRAINT "mailroom_print_job_error_check" CHECK (("status" NOT IN ('FAILED','UNKNOWN') OR "error_code" IS NOT NULL) AND ("status" NOT IN ('QUEUED','CLAIMED','SUBMITTING') OR "error_code" IS NULL)),
  CONSTRAINT "mailroom_print_job_device_fkey" FOREIGN KEY ("device_id","entity_id") REFERENCES "mailroom_print_devices"("id","entity_id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "mailroom_print_job_company_key" ON "mailroom_print_jobs"("id","entity_id");
CREATE UNIQUE INDEX "mailroom_print_job_request_key" ON "mailroom_print_jobs"("entity_id","created_by_id","request_id");
CREATE UNIQUE INDEX "mailroom_print_job_active_key" ON "mailroom_print_jobs"("active_key");
CREATE INDEX "mailroom_print_job_claim_idx" ON "mailroom_print_jobs"("device_id","status","created_at");
CREATE INDEX "mailroom_print_job_expiry_idx" ON "mailroom_print_jobs"("entity_id","expires_at");
CREATE INDEX "mailroom_print_job_items_idx" ON "mailroom_print_jobs" USING GIN("item_ids");
ALTER TABLE "mailroom_print_jobs" ADD CONSTRAINT "mailroom_print_job_reprint_fkey" FOREIGN KEY ("reprint_of","entity_id") REFERENCES "mailroom_print_jobs"("id","entity_id") ON DELETE RESTRICT ON UPDATE CASCADE;

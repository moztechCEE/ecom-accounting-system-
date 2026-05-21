ALTER TABLE "customers"
ADD COLUMN "code" TEXT,
ADD COLUMN "phone_extension" TEXT,
ADD COLUMN "contact_person" TEXT;

CREATE INDEX "customers_entity_id_code_idx" ON "customers"("entity_id", "code");

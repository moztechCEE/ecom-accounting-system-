-- Reviewed DEV integration: central schema/migration owner reviews and assigns a migration.
CREATE TABLE "repair_test_standards" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "entity_id" TEXT NOT NULL REFERENCES "entities"("id") ON DELETE RESTRICT,
  "product_id" TEXT NOT NULL,
  "sku" TEXT NOT NULL,
  "revision" INTEGER NOT NULL CHECK (revision > 0),
  "status" TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','REVIEWED','RETIRED')),
  "data" JSONB NOT NULL,
  "content_hash" TEXT NOT NULL,
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewed_by_id" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "retired_by_id" TEXT,
  "retired_at" TIMESTAMP(3),
  "command_keys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "commands" JSONB NOT NULL DEFAULT '{}',
  FOREIGN KEY ("product_id","entity_id") REFERENCES "products"("id","entity_id") ON DELETE RESTRICT,
  UNIQUE ("entity_id","product_id","sku","revision"),
  CHECK (status <> 'REVIEWED' OR (reviewed_by_id IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE UNIQUE INDEX "repair_test_standard_current" ON "repair_test_standards" ("entity_id","product_id","sku") WHERE status='REVIEWED';
CREATE INDEX "repair_test_standard_scope" ON "repair_test_standards" ("entity_id","product_id","sku","status");
CREATE TABLE "repair_calibration_records" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "entity_id" TEXT NOT NULL REFERENCES "entities"("id") ON DELETE RESTRICT,
  "instrument_id" TEXT NOT NULL,
  "equipment_type" TEXT NOT NULL,
  "proof_reference" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'VALID' CHECK (status IN ('VALID','REVOKED')),
  "valid_from" TIMESTAMP(3) NOT NULL,
  "valid_until" TIMESTAMP(3) NOT NULL,
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_by_id" TEXT,
  "revoked_at" TIMESTAMP(3),
  "command_keys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "commands" JSONB NOT NULL DEFAULT '{}',
  UNIQUE ("entity_id","instrument_id","proof_reference"),
  CHECK (valid_until > valid_from)
);
CREATE INDEX "repair_calibration_scope" ON "repair_calibration_records" ("entity_id","instrument_id","status","valid_from","valid_until");

CREATE FUNCTION repair_test_standard_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.entity_id IS DISTINCT FROM OLD.entity_id OR NEW.product_id IS DISTINCT FROM OLD.product_id
    OR NEW.sku IS DISTINCT FROM OLD.sku OR NEW.revision IS DISTINCT FROM OLD.revision
    OR NEW.data IS DISTINCT FROM OLD.data OR NEW.created_by_id IS DISTINCT FROM OLD.created_by_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'repair standard revision content is immutable';
  END IF;
  IF OLD.status <> 'DRAFT' AND (NEW.content_hash IS DISTINCT FROM OLD.content_hash
    OR NEW.reviewed_by_id IS DISTINCT FROM OLD.reviewed_by_id OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at) THEN
    RAISE EXCEPTION 'reviewed repair standard evidence is immutable';
  END IF;
  IF OLD.status='RETIRED' AND NEW.status <> 'RETIRED' THEN
    RAISE EXCEPTION 'retired repair standard needs a new revision';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER repair_test_standard_immutable BEFORE UPDATE ON repair_test_standards FOR EACH ROW EXECUTE FUNCTION repair_test_standard_immutable();
CREATE FUNCTION repair_calibration_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.entity_id IS DISTINCT FROM OLD.entity_id OR NEW.instrument_id IS DISTINCT FROM OLD.instrument_id
    OR NEW.equipment_type IS DISTINCT FROM OLD.equipment_type OR NEW.proof_reference IS DISTINCT FROM OLD.proof_reference
    OR NEW.valid_from IS DISTINCT FROM OLD.valid_from OR NEW.valid_until IS DISTINCT FROM OLD.valid_until
    OR NEW.created_by_id IS DISTINCT FROM OLD.created_by_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'repair calibration certificate is immutable';
  END IF;
  IF OLD.status='REVOKED' AND NEW.status <> 'REVOKED' THEN
    RAISE EXCEPTION 'revoked repair calibration needs a new certificate';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER repair_calibration_immutable BEFORE UPDATE ON repair_calibration_records FOR EACH ROW EXECUTE FUNCTION repair_calibration_immutable();

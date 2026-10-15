-- Null preserves each existing location's inherited rack purpose; no backfill.
ALTER TABLE "mailroom_storage_locations" ADD COLUMN "purpose" TEXT;

ALTER TABLE "mailroom_storage_locations"
  ADD CONSTRAINT "mailroom_storage_locations_purpose_check"
  CHECK ("purpose" IS NULL OR "purpose" IN ('RECEIVING', 'OUTBOUND'));

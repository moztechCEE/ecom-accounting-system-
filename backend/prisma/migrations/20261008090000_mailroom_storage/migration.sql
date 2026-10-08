-- A nullable storage reference preserves existing free-text locations.
CREATE TABLE "mailroom_storage_racks" (
  "id" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "zone" TEXT NOT NULL,
  "rows" INTEGER NOT NULL,
  "columns" INTEGER NOT NULL,
  "layout_x" INTEGER NOT NULL DEFAULT 0,
  "layout_y" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 1,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "command_keys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "commands" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mailroom_storage_racks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mailroom_storage_racks_zone_check" CHECK ("zone" IN ('RECEIVING', 'OUTBOUND')),
  CONSTRAINT "mailroom_storage_racks_dimensions_check" CHECK ("rows" BETWEEN 1 AND 8 AND "columns" BETWEEN 1 AND 8)
);

CREATE TABLE "mailroom_storage_locations" (
  "id" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "rack_id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "level" INTEGER NOT NULL,
  "slot" INTEGER NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "command_keys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "commands" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mailroom_storage_locations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mailroom_storage_locations_position_check" CHECK ("level" BETWEEN 1 AND 8 AND "slot" BETWEEN 1 AND 8)
);

CREATE UNIQUE INDEX "mailroom_storage_racks_id_entity_id_key" ON "mailroom_storage_racks"("id", "entity_id");
CREATE UNIQUE INDEX "mailroom_storage_racks_entity_id_code_key" ON "mailroom_storage_racks"("entity_id", "code");
CREATE INDEX "mailroom_storage_racks_entity_id_is_active_idx" ON "mailroom_storage_racks"("entity_id", "is_active");
CREATE UNIQUE INDEX "mailroom_storage_locations_id_entity_id_key" ON "mailroom_storage_locations"("id", "entity_id");
CREATE UNIQUE INDEX "mailroom_storage_locations_entity_id_code_key" ON "mailroom_storage_locations"("entity_id", "code");
CREATE UNIQUE INDEX "mailroom_storage_locations_rack_id_level_slot_key" ON "mailroom_storage_locations"("rack_id", "level", "slot");
CREATE INDEX "mailroom_storage_locations_entity_id_rack_id_idx" ON "mailroom_storage_locations"("entity_id", "rack_id");
ALTER TABLE "mailroom_storage_locations" ADD CONSTRAINT "mailroom_storage_locations_rack_id_entity_id_fkey" FOREIGN KEY ("rack_id", "entity_id") REFERENCES "mailroom_storage_racks"("id", "entity_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "mailroom_items" ADD COLUMN "storage_location_id" TEXT;
CREATE INDEX "mailroom_items_entity_id_storage_location_id_idx" ON "mailroom_items"("entity_id", "storage_location_id");
ALTER TABLE "mailroom_items" ADD CONSTRAINT "mailroom_items_storage_location_id_entity_id_fkey" FOREIGN KEY ("storage_location_id", "entity_id") REFERENCES "mailroom_storage_locations"("id", "entity_id") ON DELETE RESTRICT ON UPDATE CASCADE;

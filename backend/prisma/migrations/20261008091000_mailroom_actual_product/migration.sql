ALTER TABLE "mailroom_items" ADD COLUMN "product_id" TEXT, ADD COLUMN "barcode" TEXT;

CREATE INDEX "mailroom_items_entity_id_product_id_idx" ON "mailroom_items"("entity_id", "product_id");

ALTER TABLE "mailroom_items" ADD CONSTRAINT "mailroom_items_product_id_entity_id_fkey"
  FOREIGN KEY ("product_id", "entity_id") REFERENCES "products"("id", "entity_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

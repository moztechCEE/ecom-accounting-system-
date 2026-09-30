-- The brand displayed by the anonymous catalog is set explicitly by staff.
-- Product.category remains the existing category source.
ALTER TABLE "b2b_product_price_books" ADD COLUMN "brand" VARCHAR(100);

CREATE INDEX "b2b_product_price_books_public_brand_idx"
  ON "b2b_product_price_books"("entity_id", "brand")
  WHERE "is_public" = true;

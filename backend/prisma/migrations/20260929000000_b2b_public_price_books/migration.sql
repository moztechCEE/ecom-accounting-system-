-- Public list/regular prices and dated offers are deliberately separate from
-- products.sales_price, which marketplace intake may update per transaction.
-- Composite FKs prevent a price record from pointing across company entities.
CREATE UNIQUE INDEX "products_id_entity_id_key" ON "products"("id", "entity_id");
CREATE UNIQUE INDEX "customers_id_entity_id_key" ON "customers"("id", "entity_id");

CREATE TABLE "b2b_product_price_books" (
  "id" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "msrp" DECIMAL(18,2) NOT NULL,
  "regular_price" DECIMAL(18,2),
  "group_buy_price" DECIMAL(18,2),
  "is_public" BOOLEAN NOT NULL DEFAULT false,
  "currency" TEXT NOT NULL,
  "tax_basis" TEXT NOT NULL,
  "created_by" TEXT NOT NULL,
  "updated_by" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "b2b_product_price_books_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "b2b_price_book_amounts_positive" CHECK (
    "msrp" > 0 AND ("regular_price" IS NULL OR "regular_price" > 0)
    AND ("group_buy_price" IS NULL OR "group_buy_price" > 0)
  ),
  CONSTRAINT "b2b_price_book_currency_supported" CHECK ("currency" = 'TWD'),
  CONSTRAINT "b2b_price_book_tax_basis_supported" CHECK ("tax_basis" IN ('TAX_INCLUDED', 'TAX_EXCLUDED'))
);
CREATE UNIQUE INDEX "b2b_product_price_books_entity_id_product_id_key" ON "b2b_product_price_books"("entity_id", "product_id");
ALTER TABLE "b2b_product_price_books" ADD CONSTRAINT "b2b_product_price_books_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "b2b_product_price_books" ADD CONSTRAINT "b2b_product_price_books_product_id_entity_id_fkey" FOREIGN KEY ("product_id", "entity_id") REFERENCES "products"("id", "entity_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "b2b_price_offers" (
  "id" TEXT NOT NULL,
  "price_book_id" TEXT NOT NULL,
  "unit_price" DECIMAL(18,2) NOT NULL,
  "starts_at" TIMESTAMPTZ NOT NULL,
  "ends_at" TIMESTAMPTZ NOT NULL,
  "audience" TEXT NOT NULL,
  "audience_code" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by" TEXT NOT NULL,
  "updated_by" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "b2b_price_offers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "b2b_price_offer_amount_positive" CHECK ("unit_price" > 0),
  CONSTRAINT "b2b_price_offer_window_valid" CHECK ("starts_at" < "ends_at"),
  CONSTRAINT "b2b_price_offer_audience_valid" CHECK (
    ("audience" = 'ALL' AND "audience_code" IS NULL)
    OR ("audience" = 'CODE' AND "audience_code" IS NOT NULL AND length(trim("audience_code")) > 0)
  )
);
CREATE INDEX "b2b_price_offers_price_book_id_starts_at_ends_at_idx" ON "b2b_price_offers"("price_book_id", "starts_at", "ends_at");
ALTER TABLE "b2b_price_offers" ADD CONSTRAINT "b2b_price_offers_price_book_id_fkey" FOREIGN KEY ("price_book_id") REFERENCES "b2b_product_price_books"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "b2b_customer_discount_rules" (
  "id" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "multiplier" DECIMAL(5,4) NOT NULL,
  "base_price_type" TEXT NOT NULL,
  "valid_from" TIMESTAMPTZ NOT NULL,
  "valid_until" TIMESTAMPTZ,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by" TEXT NOT NULL,
  "updated_by" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "b2b_customer_discount_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "b2b_customer_discount_multiplier_valid" CHECK ("multiplier" > 0 AND "multiplier" <= 1),
  CONSTRAINT "b2b_customer_discount_base_valid" CHECK ("base_price_type" IN ('MSRP', 'REGULAR')),
  CONSTRAINT "b2b_customer_discount_window_valid" CHECK ("valid_until" IS NULL OR "valid_from" < "valid_until")
);
CREATE UNIQUE INDEX "b2b_customer_discount_rules_entity_id_customer_id_key" ON "b2b_customer_discount_rules"("entity_id", "customer_id");
ALTER TABLE "b2b_customer_discount_rules" ADD CONSTRAINT "b2b_customer_discount_rules_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "b2b_customer_discount_rules" ADD CONSTRAINT "b2b_customer_discount_rules_customer_id_entity_id_fkey" FOREIGN KEY ("customer_id", "entity_id") REFERENCES "customers"("id", "entity_id") ON DELETE RESTRICT ON UPDATE CASCADE;

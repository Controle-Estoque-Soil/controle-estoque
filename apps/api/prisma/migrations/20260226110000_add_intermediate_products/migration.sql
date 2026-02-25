CREATE TYPE "ProductKind" AS ENUM ('FINAL', 'INTERMEDIATE');

ALTER TABLE "products"
ADD COLUMN "kind" "ProductKind" NOT NULL DEFAULT 'FINAL';

CREATE INDEX "products_kind_idx" ON "products"("kind");

CREATE TABLE "product_bom_intermediate_products" (
  "id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "intermediate_product_id" TEXT NOT NULL,
  "qty_required" NUMERIC(18, 6) NOT NULL,

  CONSTRAINT "product_bom_intermediate_products_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_bom_intermediate_products_product_id_intermediate_pro_key"
ON "product_bom_intermediate_products"("product_id", "intermediate_product_id");

CREATE INDEX "product_bom_intermediate_products_intermediate_product_id_idx"
ON "product_bom_intermediate_products"("intermediate_product_id");

ALTER TABLE "product_bom_intermediate_products"
ADD CONSTRAINT "product_bom_intermediate_products_product_id_fkey"
FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_bom_intermediate_products"
ADD CONSTRAINT "product_bom_intermediate_products_intermediate_product_id_fkey"
FOREIGN KEY ("intermediate_product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

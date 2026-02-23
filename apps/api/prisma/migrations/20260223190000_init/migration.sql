CREATE TYPE "Role" AS ENUM ('ADMIN', 'USER');
CREATE TYPE "OperationType" AS ENUM ('INBOUND_PRODUCT', 'OUTBOUND_PRODUCT');
CREATE TYPE "StockMovementReason" AS ENUM ('MANUAL_ADJUSTMENT', 'PRODUCT_INBOUND', 'PRODUCT_OUTBOUND');
CREATE TYPE "StockMovementReferenceType" AS ENUM ('PRODUCT_ORDER', 'MANUAL_ADJUSTMENT');

CREATE TABLE "users" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "role" "Role" NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "items" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sku" TEXT NOT NULL,
  "unit" TEXT NOT NULL,
  "unit_price" DECIMAL(18, 6) NOT NULL,
  "qty_on_hand" DECIMAL(18, 6) NOT NULL DEFAULT 0,
  "min_qty" DECIMAL(18, 6),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "products" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sku" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "product_bom_items" (
  "id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "item_id" TEXT NOT NULL,
  "qty_required" DECIMAL(18, 6) NOT NULL,
  CONSTRAINT "product_bom_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stock_movements" (
  "id" TEXT NOT NULL,
  "item_id" TEXT NOT NULL,
  "delta_qty" DECIMAL(18, 6) NOT NULL,
  "reason" "StockMovementReason" NOT NULL,
  "reference_type" "StockMovementReferenceType" NOT NULL,
  "reference_id" TEXT,
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_user_id" TEXT NOT NULL,
  CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "product_orders" (
  "id" TEXT NOT NULL,
  "type" "OperationType" NOT NULL,
  "product_id" TEXT NOT NULL,
  "product_qty" DECIMAL(18, 6) NOT NULL,
  "total_cost" DECIMAL(18, 6),
  "unit_cost" DECIMAL(18, 6),
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_user_id" TEXT NOT NULL,
  CONSTRAINT "product_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "product_order_lines" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "item_id" TEXT NOT NULL,
  "item_qty" DECIMAL(18, 6) NOT NULL,
  "item_unit_price_snapshot" DECIMAL(18, 6) NOT NULL,
  "line_cost" DECIMAL(18, 6) NOT NULL,
  CONSTRAINT "product_order_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "items_sku_key" ON "items"("sku");
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");
CREATE UNIQUE INDEX "product_bom_items_product_id_item_id_key" ON "product_bom_items"("product_id", "item_id");

CREATE INDEX "items_active_idx" ON "items"("active");
CREATE INDEX "items_name_idx" ON "items"("name");
CREATE INDEX "products_active_idx" ON "products"("active");
CREATE INDEX "products_name_idx" ON "products"("name");
CREATE INDEX "product_bom_items_item_id_idx" ON "product_bom_items"("item_id");
CREATE INDEX "stock_movements_item_id_created_at_idx" ON "stock_movements"("item_id", "created_at");
CREATE INDEX "stock_movements_created_at_idx" ON "stock_movements"("created_at");
CREATE INDEX "stock_movements_reference_type_reference_id_idx" ON "stock_movements"("reference_type", "reference_id");
CREATE INDEX "product_orders_product_id_created_at_idx" ON "product_orders"("product_id", "created_at");
CREATE INDEX "product_orders_type_created_at_idx" ON "product_orders"("type", "created_at");
CREATE INDEX "product_orders_created_at_idx" ON "product_orders"("created_at");
CREATE INDEX "product_order_lines_item_id_idx" ON "product_order_lines"("item_id");
CREATE INDEX "product_order_lines_order_id_idx" ON "product_order_lines"("order_id");

ALTER TABLE "product_bom_items"
  ADD CONSTRAINT "product_bom_items_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_bom_items"
  ADD CONSTRAINT "product_bom_items_item_id_fkey"
  FOREIGN KEY ("item_id") REFERENCES "items"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_item_id_fkey"
  FOREIGN KEY ("item_id") REFERENCES "items"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "product_orders"
  ADD CONSTRAINT "product_orders_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "product_orders"
  ADD CONSTRAINT "product_orders_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "product_order_lines"
  ADD CONSTRAINT "product_order_lines_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "product_orders"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_order_lines"
  ADD CONSTRAINT "product_order_lines_item_id_fkey"
  FOREIGN KEY ("item_id") REFERENCES "items"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

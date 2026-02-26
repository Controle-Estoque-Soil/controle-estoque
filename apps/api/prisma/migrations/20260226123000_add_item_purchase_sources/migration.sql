CREATE TABLE "item_purchase_sources" (
  "id" TEXT NOT NULL,
  "item_id" TEXT NOT NULL,
  "source" TEXT,
  "price" NUMERIC(18, 6),
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "item_purchase_sources_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "item_purchase_sources_item_id_sort_order_idx"
ON "item_purchase_sources"("item_id", "sort_order");

ALTER TABLE "item_purchase_sources"
ADD CONSTRAINT "item_purchase_sources_item_id_fkey"
FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

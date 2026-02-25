-- Track compensating reversals to prevent duplicate undo operations
ALTER TABLE "product_orders"
ADD COLUMN "reversal_of_order_id" TEXT;

ALTER TABLE "stock_movements"
ADD COLUMN "reversal_of_movement_id" TEXT;

CREATE UNIQUE INDEX "product_orders_reversal_of_order_id_key"
ON "product_orders"("reversal_of_order_id");

CREATE UNIQUE INDEX "stock_movements_reversal_of_movement_id_key"
ON "stock_movements"("reversal_of_movement_id");

ALTER TABLE "product_orders"
ADD CONSTRAINT "product_orders_reversal_of_order_id_fkey"
FOREIGN KEY ("reversal_of_order_id")
REFERENCES "product_orders"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "stock_movements"
ADD CONSTRAINT "stock_movements_reversal_of_movement_id_fkey"
FOREIGN KEY ("reversal_of_movement_id")
REFERENCES "stock_movements"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

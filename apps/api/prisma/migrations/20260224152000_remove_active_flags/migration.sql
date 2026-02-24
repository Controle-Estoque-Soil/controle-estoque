DROP INDEX IF EXISTS "items_active_idx";
DROP INDEX IF EXISTS "products_active_idx";

ALTER TABLE "items" DROP COLUMN IF EXISTS "active";
ALTER TABLE "products" DROP COLUMN IF EXISTS "active";

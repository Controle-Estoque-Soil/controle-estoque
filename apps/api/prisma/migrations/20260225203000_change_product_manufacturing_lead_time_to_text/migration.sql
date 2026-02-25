ALTER TABLE "products"
ALTER COLUMN "manufacturing_lead_time_days" TYPE TEXT
USING "manufacturing_lead_time_days"::text;

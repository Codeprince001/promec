ALTER TABLE "vendor_reviews" ADD COLUMN "hidden" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "notifications" ADD COLUMN "read_at" TIMESTAMP(3);

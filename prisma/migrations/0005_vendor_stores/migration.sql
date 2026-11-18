ALTER TABLE "vendors" ADD COLUMN "slug" TEXT;
ALTER TABLE "vendors" ADD COLUMN "logo_url" TEXT;
ALTER TABLE "vendors" ADD COLUMN "banner_url" TEXT;
ALTER TABLE "vendors" ADD COLUMN "description" TEXT;
ALTER TABLE "vendors" ADD COLUMN "phone" TEXT;
ALTER TABLE "vendors" ADD COLUMN "address_line" TEXT;
ALTER TABLE "vendors" ADD COLUMN "city" TEXT;
ALTER TABLE "vendors" ADD COLUMN "state" TEXT;
ALTER TABLE "vendors" ADD COLUMN "country" TEXT NOT NULL DEFAULT 'NG';
ALTER TABLE "vendors" ADD COLUMN "policies" TEXT;
ALTER TABLE "vendors" ADD COLUMN "payout_bank_name" TEXT;
ALTER TABLE "vendors" ADD COLUMN "payout_account_name" TEXT;
ALTER TABLE "vendors" ADD COLUMN "payout_account_number" TEXT;
ALTER TABLE "vendors" ADD COLUMN "rating_avg" DECIMAL(4,2) NOT NULL DEFAULT 0;
ALTER TABLE "vendors" ADD COLUMN "rating_count" INTEGER NOT NULL DEFAULT 0;

UPDATE "vendors"
SET "slug" = 'store-' || substr(replace("id", '-', ''), 1, 12)
WHERE "slug" IS NULL;

ALTER TABLE "vendors" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "vendors_slug_key" ON "vendors"("slug");
CREATE INDEX "products_vendor_id_idx" ON "products"("vendor_id");

CREATE TABLE "vendor_reviews" (
    "id" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "vendor_reviews_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vendor_reviews_vendor_id_order_id_key" ON "vendor_reviews"("vendor_id", "order_id");
CREATE INDEX "vendor_reviews_vendor_id_created_at_idx" ON "vendor_reviews"("vendor_id", "created_at");

CREATE TABLE "vendor_withdrawals" (
    "id" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "bank_name" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "note" TEXT,
    "reference" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),
    "decided_by" TEXT,
    CONSTRAINT "vendor_withdrawals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "vendor_withdrawals_vendor_id_status_idx" ON "vendor_withdrawals"("vendor_id", "status");
CREATE INDEX "vendor_withdrawals_status_requested_at_idx" ON "vendor_withdrawals"("status", "requested_at");

ALTER TABLE "vendor_reviews" ADD CONSTRAINT "vendor_reviews_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vendor_reviews" ADD CONSTRAINT "vendor_reviews_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vendor_reviews" ADD CONSTRAINT "vendor_reviews_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vendor_withdrawals" ADD CONSTRAINT "vendor_withdrawals_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

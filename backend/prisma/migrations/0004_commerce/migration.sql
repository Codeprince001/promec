ALTER TABLE "quotes" ADD COLUMN "order_id" TEXT;
ALTER TABLE "quote_items" ADD COLUMN "sku_id" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN "rfq_id" TEXT;

CREATE UNIQUE INDEX "quotes_order_id_key" ON "quotes"("order_id");
CREATE UNIQUE INDEX "purchase_orders_rfq_id_key" ON "purchase_orders"("rfq_id");

CREATE TABLE "stock_transfers" (
    "id" TEXT NOT NULL,
    "transfer_no" TEXT NOT NULL,
    "from_warehouse_id" TEXT NOT NULL,
    "to_warehouse_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "created_by" TEXT,
    "shipped_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stock_transfer_lines" (
    "id" TEXT NOT NULL,
    "transfer_id" TEXT NOT NULL,
    "sku_id" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    CONSTRAINT "stock_transfer_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "requests_for_quote" (
    "id" TEXT NOT NULL,
    "rfq_no" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "notes" TEXT,
    "due_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "requests_for_quote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rfq_lines" (
    "id" TEXT NOT NULL,
    "rfq_id" TEXT NOT NULL,
    "sku_id" TEXT,
    "description" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    CONSTRAINT "rfq_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "supplier_quotes" (
    "id" TEXT NOT NULL,
    "rfq_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'quoted',
    "currency" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "supplier_quotes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "supplier_quote_lines" (
    "id" TEXT NOT NULL,
    "quote_id" TEXT NOT NULL,
    "rfq_line_id" TEXT NOT NULL,
    "unit_price" DECIMAL(18,4) NOT NULL,
    "lead_time_days" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "supplier_quote_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "price_lists" (
    "id" TEXT NOT NULL,
    "business_account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "status" TEXT NOT NULL DEFAULT 'active',
    "valid_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "price_lists_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "price_list_items" (
    "id" TEXT NOT NULL,
    "price_list_id" TEXT NOT NULL,
    "sku_id" TEXT NOT NULL,
    "unit_price" DECIMAL(18,4) NOT NULL,
    CONSTRAINT "price_list_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vendor_stock" (
    "vendor_id" TEXT NOT NULL,
    "sku_id" TEXT NOT NULL,
    "on_hand_qty" INTEGER NOT NULL DEFAULT 0,
    "reserved_qty" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "vendor_stock_pkey" PRIMARY KEY ("vendor_id","sku_id")
);

CREATE TABLE "vendor_reservations" (
    "id" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "sku_id" TEXT NOT NULL,
    "order_item_id" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "vendor_reservations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vendor_ledger" (
    "id" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "order_id" TEXT,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "vendor_ledger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stock_transfers_transfer_no_key" ON "stock_transfers"("transfer_no");
CREATE INDEX "stock_transfers_status_idx" ON "stock_transfers"("status");
CREATE INDEX "stock_transfer_lines_transfer_id_idx" ON "stock_transfer_lines"("transfer_id");
CREATE UNIQUE INDEX "requests_for_quote_rfq_no_key" ON "requests_for_quote"("rfq_no");
CREATE INDEX "rfq_lines_rfq_id_idx" ON "rfq_lines"("rfq_id");
CREATE UNIQUE INDEX "supplier_quotes_rfq_id_supplier_id_key" ON "supplier_quotes"("rfq_id", "supplier_id");
CREATE INDEX "supplier_quote_lines_quote_id_idx" ON "supplier_quote_lines"("quote_id");
CREATE INDEX "price_lists_business_account_id_status_idx" ON "price_lists"("business_account_id", "status");
CREATE UNIQUE INDEX "price_list_items_price_list_id_sku_id_key" ON "price_list_items"("price_list_id", "sku_id");
CREATE INDEX "vendor_reservations_order_item_id_idx" ON "vendor_reservations"("order_item_id");
CREATE INDEX "vendor_reservations_status_expires_at_idx" ON "vendor_reservations"("status", "expires_at");
CREATE INDEX "vendor_ledger_vendor_id_created_at_idx" ON "vendor_ledger"("vendor_id", "created_at");
CREATE INDEX "vendor_ledger_order_id_idx" ON "vendor_ledger"("order_id");

ALTER TABLE "quotes" ADD CONSTRAINT "quotes_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "product_skus"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_rfq_id_fkey" FOREIGN KEY ("rfq_id") REFERENCES "requests_for_quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_from_warehouse_id_fkey" FOREIGN KEY ("from_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_to_warehouse_id_fkey" FOREIGN KEY ("to_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "stock_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rfq_lines" ADD CONSTRAINT "rfq_lines_rfq_id_fkey" FOREIGN KEY ("rfq_id") REFERENCES "requests_for_quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_quotes" ADD CONSTRAINT "supplier_quotes_rfq_id_fkey" FOREIGN KEY ("rfq_id") REFERENCES "requests_for_quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_quote_lines" ADD CONSTRAINT "supplier_quote_lines_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "supplier_quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_quote_lines" ADD CONSTRAINT "supplier_quote_lines_rfq_line_id_fkey" FOREIGN KEY ("rfq_line_id") REFERENCES "rfq_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_business_account_id_fkey" FOREIGN KEY ("business_account_id") REFERENCES "business_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_price_list_id_fkey" FOREIGN KEY ("price_list_id") REFERENCES "price_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "product_skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vendor_stock" ADD CONSTRAINT "vendor_stock_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vendor_stock" ADD CONSTRAINT "vendor_stock_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "product_skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vendor_ledger" ADD CONSTRAINT "vendor_ledger_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vendor_ledger" ADD CONSTRAINT "vendor_ledger_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

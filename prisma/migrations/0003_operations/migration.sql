-- Account recovery
ALTER TABLE "users" ADD COLUMN "email_verified_at" TIMESTAMP(3);

CREATE TABLE "auth_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "auth_tokens_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "recovery_codes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "recovery_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "auth_tokens_token_hash_key" ON "auth_tokens"("token_hash");
CREATE INDEX "auth_tokens_user_id_purpose_idx" ON "auth_tokens"("user_id", "purpose");
CREATE UNIQUE INDEX "recovery_codes_code_hash_key" ON "recovery_codes"("code_hash");
CREATE INDEX "recovery_codes_user_id_idx" ON "recovery_codes"("user_id");

ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Bank transfer proof
CREATE TABLE "payment_proofs" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "bank_reference" TEXT NOT NULL,
    "evidence_url" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "note" TEXT,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payment_proofs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_proofs_payment_id_bank_reference_key" ON "payment_proofs"("payment_id", "bank_reference");
CREATE INDEX "payment_proofs_status_idx" ON "payment_proofs"("status");
ALTER TABLE "payment_proofs" ADD CONSTRAINT "payment_proofs_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Returns and shipments
ALTER TABLE "return_requests" ADD COLUMN "inspection_note" TEXT;
ALTER TABLE "return_requests" ADD COLUMN "restock_qty" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "return_requests" ADD COLUMN "inspected_at" TIMESTAMP(3);

ALTER TABLE "shipments" ADD COLUMN "label_url" TEXT;
ALTER TABLE "shipments" ADD COLUMN "carrier_ref" TEXT;

-- Support, part quotes, notifications
ALTER TABLE "part_requests" ADD COLUMN "assignee_id" TEXT;
ALTER TABLE "part_requests" ADD COLUMN "quoted_price" DECIMAL(18,4);
ALTER TABLE "part_requests" ADD COLUMN "quote_note" TEXT;
ALTER TABLE "part_requests" ADD COLUMN "due_at" TIMESTAMP(3);

ALTER TABLE "support_tickets" ADD COLUMN "due_at" TIMESTAMP(3);
ALTER TABLE "support_tickets" ADD COLUMN "first_response_at" TIMESTAMP(3);

ALTER TABLE "notifications" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "notifications" ADD COLUMN "last_error" TEXT;
CREATE INDEX "notifications_status_attempts_idx" ON "notifications"("status", "attempts");

-- Supplier payments
CREATE TABLE "supplier_payments" (
    "id" TEXT NOT NULL,
    "supplier_invoice_id" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'paid',
    "paid_by" TEXT,
    "paid_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "supplier_payments_supplier_invoice_id_key" ON "supplier_payments"("supplier_invoice_id");
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplier_invoice_id_fkey" FOREIGN KEY ("supplier_invoice_id") REFERENCES "supplier_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Import workflow
CREATE TABLE "import_milestones" (
    "id" TEXT NOT NULL,
    "import_record_id" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "note" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "import_milestones_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "import_documents" (
    "id" TEXT NOT NULL,
    "import_record_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "import_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "import_milestones_import_record_id_occurred_at_idx" ON "import_milestones"("import_record_id", "occurred_at");
CREATE INDEX "import_documents_import_record_id_idx" ON "import_documents"("import_record_id");
ALTER TABLE "import_milestones" ADD CONSTRAINT "import_milestones_import_record_id_fkey" FOREIGN KEY ("import_record_id") REFERENCES "import_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "import_documents" ADD CONSTRAINT "import_documents_import_record_id_fkey" FOREIGN KEY ("import_record_id") REFERENCES "import_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Bins and cycle counts
CREATE TABLE "bins" (
    "id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "zone" TEXT,
    CONSTRAINT "bins_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inventory_bins" (
    "inventory_id" TEXT NOT NULL,
    "bin_id" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "inventory_bins_pkey" PRIMARY KEY ("inventory_id", "bin_id")
);

CREATE TABLE "cycle_counts" (
    "id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "counted_by" TEXT,
    "posted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cycle_counts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cycle_count_lines" (
    "id" TEXT NOT NULL,
    "cycle_count_id" TEXT NOT NULL,
    "sku_id" TEXT NOT NULL,
    "bin_id" TEXT,
    "expected_qty" INTEGER NOT NULL,
    "counted_qty" INTEGER NOT NULL,
    CONSTRAINT "cycle_count_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bins_warehouse_id_code_key" ON "bins"("warehouse_id", "code");
CREATE INDEX "cycle_counts_warehouse_id_status_idx" ON "cycle_counts"("warehouse_id", "status");
CREATE INDEX "cycle_count_lines_cycle_count_id_idx" ON "cycle_count_lines"("cycle_count_id");

ALTER TABLE "bins" ADD CONSTRAINT "bins_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_bins" ADD CONSTRAINT "inventory_bins_inventory_id_fkey" FOREIGN KEY ("inventory_id") REFERENCES "inventory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_bins" ADD CONSTRAINT "inventory_bins_bin_id_fkey" FOREIGN KEY ("bin_id") REFERENCES "bins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cycle_counts" ADD CONSTRAINT "cycle_counts_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cycle_count_lines" ADD CONSTRAINT "cycle_count_lines_cycle_count_id_fkey" FOREIGN KEY ("cycle_count_id") REFERENCES "cycle_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Sales, fitment, and purchasing history
CREATE TABLE "analytics_events" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "dimensions" JSONB NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "analytics_events_kind_occurred_at_idx" ON "analytics_events"("kind", "occurred_at");

-- CreateTable
CREATE TABLE "mailroom_receipts" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "source_case_id" TEXT,
    "source_number" TEXT,
    "source_snapshot" JSONB,
    "carrier" TEXT,
    "tracking_number" TEXT,
    "sender_label" TEXT,
    "received_by_id" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "request_id" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,

    CONSTRAINT "mailroom_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mailroom_items" (
    "id" TEXT NOT NULL,
    "receipt_id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "declared" JSONB,
    "product_name" TEXT NOT NULL,
    "sku" TEXT,
    "serial_number" TEXT,
    "status" TEXT NOT NULL,
    "match_result" TEXT NOT NULL DEFAULT 'PENDING',
    "grade" TEXT,
    "disposition" TEXT,
    "condition_note" TEXT,
    "evidence" JSONB,
    "location" TEXT NOT NULL,
    "custodian_id" TEXT NOT NULL,
    "recipient_id" TEXT,
    "next_user_id" TEXT,
    "repair_owner_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mailroom_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mailroom_actions" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "actor_name" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "note" TEXT,
    "snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mailroom_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mailroom_tasks" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "version" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "mailroom_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mailroom_deliveries" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_until" TIMESTAMP(3),
    "lease_token" TEXT,
    "last_error" TEXT,
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mailroom_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mailroom_receipts_number_key" ON "mailroom_receipts"("number");

-- CreateIndex
CREATE INDEX "mailroom_receipts_entity_id_received_at_idx" ON "mailroom_receipts"("entity_id", "received_at");

-- CreateIndex
CREATE INDEX "mailroom_receipts_entity_id_source_case_id_idx" ON "mailroom_receipts"("entity_id", "source_case_id");

-- CreateIndex
CREATE UNIQUE INDEX "mailroom_receipts_entity_id_received_by_id_request_id_key" ON "mailroom_receipts"("entity_id", "received_by_id", "request_id");

-- CreateIndex
CREATE INDEX "mailroom_items_entity_id_status_created_at_idx" ON "mailroom_items"("entity_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "mailroom_items_recipient_id_status_idx" ON "mailroom_items"("recipient_id", "status");

-- CreateIndex
CREATE INDEX "mailroom_items_next_user_id_status_idx" ON "mailroom_items"("next_user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "mailroom_actions_entity_id_actor_id_request_id_key" ON "mailroom_actions"("entity_id", "actor_id", "request_id");

-- CreateIndex
CREATE UNIQUE INDEX "mailroom_actions_item_id_version_key" ON "mailroom_actions"("item_id", "version");

-- CreateIndex
CREATE INDEX "mailroom_tasks_user_id_status_created_at_idx" ON "mailroom_tasks"("user_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "mailroom_tasks_item_id_user_id_kind_version_key" ON "mailroom_tasks"("item_id", "user_id", "kind", "version");

-- CreateIndex
CREATE INDEX "mailroom_deliveries_status_next_attempt_at_idx" ON "mailroom_deliveries"("status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "mailroom_deliveries_event_id_target_key" ON "mailroom_deliveries"("event_id", "target");

-- AddForeignKey
ALTER TABLE "mailroom_items" ADD CONSTRAINT "mailroom_items_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "mailroom_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mailroom_actions" ADD CONSTRAINT "mailroom_actions_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "mailroom_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mailroom_tasks" ADD CONSTRAINT "mailroom_tasks_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "mailroom_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- New role templates only. Assign employees through the normal access-control screen.
INSERT INTO permissions (id,resource,action,description) VALUES
('mailroom-read','mailroom','read','收發室收件與歷程'),
('mailroom-create','mailroom','create','建立收件紀錄'),
('mailroom-update','mailroom','update','核對、分級與交接'),
('mailroom-review','mailroom','review','客服確認品項不符後繼續處理'),
('repair-workbench-read','repair_workbench','read','查看指派維修／整新物件'),
('repair-workbench-update','repair_workbench','update','本人簽收並處理維修／整新')
ON CONFLICT (resource,action) DO NOTHING;
INSERT INTO roles (id,code,name,description,hierarchy_level) VALUES
('mailroom-operator','MAILROOM_OPERATOR','收發室人員','行政部收件、核對與交接工作台',3),
('repair-technician','REPAIR_TECHNICIAN','維修人員','維修部簽收、檢測與維修整新工作台',3)
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE (r.code IN ('MAILROOM_OPERATOR','REPAIR_TECHNICIAN') AND p.resource IN ('attendance_self','leave_self','profile_self','expense_self') AND p.action='read')
OR (r.code='MAILROOM_OPERATOR' AND p.resource='mailroom' AND p.action IN ('read','create','update'))
OR (r.code='REPAIR_TECHNICIAN' AND p.resource='repair_workbench' AND p.action IN ('read','update'))
ON CONFLICT DO NOTHING;
CREATE FUNCTION mailroom_deny_history_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Mailroom history is append-only'; END $$;
CREATE TRIGGER mailroom_history_immutable BEFORE UPDATE OR DELETE ON mailroom_actions
FOR EACH ROW EXECUTE FUNCTION mailroom_deny_history_change();
ALTER TABLE mailroom_items ADD CONSTRAINT mailroom_item_version_positive CHECK (version > 0);
ALTER TABLE mailroom_actions ADD CONSTRAINT mailroom_action_version_positive CHECK (version > 0);

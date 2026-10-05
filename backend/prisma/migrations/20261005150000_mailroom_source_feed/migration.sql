-- CreateTable
CREATE TABLE "mailroom_source_cursors" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "source_instance" TEXT NOT NULL,
    "cursor" BIGINT NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "lease_token" TEXT,
    "lease_until" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mailroom_source_cursors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mailroom_source_changes" (
    "initial" BOOLEAN NOT NULL DEFAULT false,
    "id" TEXT NOT NULL,
    "cursor_id" TEXT NOT NULL,
    "source_event_id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "change" TEXT NOT NULL,
    "source_channel" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mailroom_source_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mailroom_source_cursors_entity_id_source_instance_key" ON "mailroom_source_cursors"("entity_id", "source_instance");

-- CreateIndex
CREATE UNIQUE INDEX "mailroom_source_changes_cursor_id_source_event_id_key" ON "mailroom_source_changes"("cursor_id", "source_event_id");

-- AddForeignKey
ALTER TABLE "mailroom_source_changes" ADD CONSTRAINT "mailroom_source_changes_cursor_id_fkey" FOREIGN KEY ("cursor_id") REFERENCES "mailroom_source_cursors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE FUNCTION mailroom_source_change_immutable() RETURNS TRIGGER AS $$
BEGIN RAISE EXCEPTION 'Mailroom source change history is append-only'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER mailroom_source_change_immutable BEFORE UPDATE OR DELETE ON mailroom_source_changes
 FOR EACH ROW EXECUTE FUNCTION mailroom_source_change_immutable();

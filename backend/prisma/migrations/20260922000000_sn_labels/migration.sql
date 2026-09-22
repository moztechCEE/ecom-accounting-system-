-- SN allocation owns these tables; it never posts inventory/accounting movements.
CREATE TABLE sn_label_drafts (
 id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, data JSONB NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1, batch_id TEXT,
 created_by TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sn_label_drafts_entity ON sn_label_drafts(entity_id, updated_at);
CREATE TABLE sn_label_counters (
 scope TEXT PRIMARY KEY, prefix TEXT NOT NULL UNIQUE, last_value INTEGER NOT NULL DEFAULT 0 CHECK(last_value BETWEEN 0 AND 999999)
);
CREATE TABLE sn_label_batches (
 id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, merge_key TEXT NOT NULL UNIQUE,
 data JSONB NOT NULL, quantity INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE sn_label_drafts ADD CONSTRAINT sn_label_draft_batch_fk FOREIGN KEY(batch_id) REFERENCES sn_label_batches(id);
CREATE INDEX sn_label_batches_entity ON sn_label_batches(entity_id, updated_at);
CREATE TABLE sn_label_carton_counters (scope TEXT PRIMARY KEY, last_value INTEGER NOT NULL DEFAULT 0);
CREATE TABLE sn_label_cartons (
 id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES sn_label_batches(id),
 source_id TEXT NOT NULL REFERENCES sn_label_drafts(id), ordinal INTEGER NOT NULL, quantity INTEGER NOT NULL,
 UNIQUE(batch_id, ordinal)
);
CREATE TABLE sn_label_serials (
 sn TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES sn_label_batches(id),
 source_id TEXT NOT NULL REFERENCES sn_label_drafts(id), carton_id TEXT NOT NULL REFERENCES sn_label_cartons(id),
 sequence INTEGER NOT NULL, position INTEGER NOT NULL, UNIQUE(carton_id, position)
);
CREATE INDEX sn_label_serials_batch ON sn_label_serials(batch_id, sequence);
CREATE TABLE sn_label_events (
 id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, batch_id TEXT REFERENCES sn_label_batches(id),
 actor_id TEXT NOT NULL, action TEXT NOT NULL, data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sn_label_events_batch ON sn_label_events(batch_id, created_at);

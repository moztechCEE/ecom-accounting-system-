-- Keep activated carton/SN ownership and event references after retirement.
-- The same merge scope may acquire a new active batch, but identifiers never recycle.
ALTER TABLE sn_label_batches ADD COLUMN retired_at TIMESTAMPTZ;
ALTER TABLE sn_label_batches DROP CONSTRAINT sn_label_batches_merge_key_key;
CREATE UNIQUE INDEX sn_label_batches_active_merge_key
  ON sn_label_batches (merge_key) WHERE retired_at IS NULL;

CREATE TABLE sn_label_batch_reversions (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES sn_label_batches(id),
  requested_by TEXT NOT NULL,
  request_reason TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  batch_snapshot JSONB NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'approved', 'rejected', 'blocked')),
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  evidence JSONB,
  replacement_draft_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  CHECK (
    (state = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL AND evidence IS NULL)
    OR (state <> 'pending' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL
        AND evidence IS NOT NULL AND reviewed_by <> requested_by)
  ),
  CHECK (jsonb_typeof(replacement_draft_ids) = 'array'),
  CHECK ((state = 'approved') = (jsonb_array_length(replacement_draft_ids) > 0))
);
CREATE UNIQUE INDEX sn_label_batch_reversions_pending
  ON sn_label_batch_reversions(batch_id) WHERE state = 'pending';
CREATE INDEX sn_label_batch_reversions_history
  ON sn_label_batch_reversions(batch_id, requested_at DESC);

-- Old tagged API revisions still run against this database. They record the
-- EXPORT event before returning bytes, and append via a batch quantity update.
-- Refuse these old write paths while a review is pending or a batch is retired.
CREATE FUNCTION sn_label_output_review_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.action = 'EXPORT' AND NEW.batch_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(726220926);
    IF EXISTS (SELECT 1 FROM sn_label_batches b WHERE b.id = NEW.batch_id AND b.retired_at IS NOT NULL)
       OR EXISTS (SELECT 1 FROM sn_label_batch_reversions r WHERE r.batch_id = NEW.batch_id AND r.state = 'pending') THEN
      RAISE EXCEPTION 'SN label batch output blocked by reversion review' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sn_label_output_review_guard
  BEFORE INSERT ON sn_label_events FOR EACH ROW EXECUTE FUNCTION sn_label_output_review_guard();

CREATE FUNCTION sn_label_append_review_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.retired_at IS NOT NULL
     OR EXISTS (SELECT 1 FROM sn_label_batch_reversions r WHERE r.batch_id = OLD.id AND r.state = 'pending') THEN
    RAISE EXCEPTION 'SN label batch append blocked by reversion review' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sn_label_append_review_guard
  BEFORE UPDATE OF quantity ON sn_label_batches FOR EACH ROW EXECUTE FUNCTION sn_label_append_review_guard();

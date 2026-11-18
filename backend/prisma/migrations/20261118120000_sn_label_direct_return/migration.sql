-- Direct returns are performed by the inventory editor. Retain the original
-- independent-review constraint for every legacy manual review decision.
DO $$
DECLARE constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid='sn_label_batch_reversions'::regclass AND contype='c'
      AND pg_get_constraintdef(oid) LIKE '%reviewed_by <> requested_by%'
  LOOP
    EXECUTE format('ALTER TABLE sn_label_batch_reversions DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END;
$$;

ALTER TABLE sn_label_batch_reversions
  ADD CONSTRAINT sn_label_reversion_actor_guard CHECK (
    (state='pending' AND reviewed_by IS NULL AND reviewed_at IS NULL AND evidence IS NULL)
    OR (
      state<>'pending' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND evidence IS NOT NULL
      AND (
        reviewed_by<>requested_by
        OR (state='approved' AND COALESCE(evidence->>'method','')='direct-return-before-receipt')
        OR (state='rejected' AND COALESCE(evidence->>'method','')='superseded-by-direct-return')
      )
    )
  );

CREATE FUNCTION sn_label_inbound_status_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  batch_entity text;
  batch_retired_at timestamptz;
BEGIN
  IF NEW.action <> 'INBOUND_STATUS_RECORDED' THEN RETURN NEW; END IF;
  IF NEW.batch_id IS NULL OR COALESCE(NEW.data->>'status','') NOT IN ('not-received','received') THEN
    RAISE EXCEPTION 'SN label inbound status is invalid' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(726220926);
  SELECT entity_id,retired_at INTO batch_entity,batch_retired_at
    FROM sn_label_batches WHERE id=NEW.batch_id FOR UPDATE;
  IF NOT FOUND OR batch_entity<>NEW.entity_id THEN
    RAISE EXCEPTION 'SN label inbound status batch or company does not match' USING ERRCODE='23514';
  END IF;
  IF batch_retired_at IS NOT NULL THEN
    RAISE EXCEPTION 'SN label retired batch cannot receive stock' USING ERRCODE='23514';
  END IF;
  IF NEW.data->>'status'='not-received' AND (
    EXISTS (
      SELECT 1 FROM sn_label_events e WHERE e.batch_id=NEW.batch_id
        AND e.action='INBOUND_STATUS_RECORDED' AND e.data->>'status'='received'
    ) OR EXISTS (
      SELECT 1 FROM sn_label_batch_reversions r WHERE r.batch_id=NEW.batch_id AND (
        r.evidence->>'blocker' IN ('ECOUNT_RECEIVED','ERP_SERIAL_IN_USE','WMS_USED','PHYSICAL_USED')
        OR CASE WHEN jsonb_typeof(r.evidence->'receipt'->'receivedQuantity')='number'
          THEN (r.evidence->'receipt'->>'receivedQuantity')::numeric>0 ELSE false END
      )
    ) OR EXISTS (
      SELECT 1 FROM sn_label_serials s JOIN inventory_serial_numbers n
        ON n.serial_number=s.sn AND n.entity_id=NEW.entity_id
        AND n.product_id=(SELECT b.data->>'productId' FROM sn_label_batches b WHERE b.id=NEW.batch_id)
      WHERE s.batch_id=NEW.batch_id
    )
  ) THEN
    RAISE EXCEPTION 'SN label batch is already received' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sn_label_inbound_status_guard
  BEFORE INSERT ON sn_label_events FOR EACH ROW EXECUTE FUNCTION sn_label_inbound_status_guard();

-- Exact registered SNs share the return lock. Unrelated inventory writes retain
-- their existing behavior and do not need a label batch.
CREATE FUNCTION sn_label_serial_receipt_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  label_batch_id text;
  label_batch_retired_at timestamptz;
BEGIN
  SELECT b.id INTO label_batch_id FROM sn_label_serials s
    JOIN sn_label_batches b ON b.id=s.batch_id
    WHERE s.sn=NEW.serial_number AND b.entity_id=NEW.entity_id
      AND b.data->>'productId'=NEW.product_id LIMIT 1;
  IF label_batch_id IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(726220926);
  SELECT retired_at INTO label_batch_retired_at
    FROM sn_label_batches WHERE id=label_batch_id FOR UPDATE;
  IF label_batch_retired_at IS NOT NULL THEN
    RAISE EXCEPTION 'SN label retired batch cannot receive stock' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM sn_label_events e WHERE e.batch_id=label_batch_id
      AND e.action='INBOUND_STATUS_RECORDED' AND e.data->>'status'='received'
  ) THEN
    INSERT INTO sn_label_events(id,entity_id,batch_id,actor_id,action,data)
    VALUES (gen_random_uuid()::text,NEW.entity_id,label_batch_id,'system:inventory-receipt',
      'INBOUND_STATUS_RECORDED',jsonb_build_object(
        'status','received','source','native-erp','serialNumber',NEW.serial_number,
        'referenceType',to_jsonb(NEW)->>'inbound_ref_type',
        'referenceId',to_jsonb(NEW)->>'inbound_ref_id'
      ));
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sn_label_serial_receipt_guard
  BEFORE INSERT OR UPDATE OF entity_id,product_id,serial_number ON inventory_serial_numbers
  FOR EACH ROW EXECUTE FUNCTION sn_label_serial_receipt_guard();

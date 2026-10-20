-- 007_availability_notify: every change of developments.availability_revision (the availability write path
-- bumps it inside the write transaction) sends NOTIFY plat_availability with { developmentId, revision }.
-- NOTIFY is delivered on COMMIT only, so listeners (GET .../availability/stream) never see a rolled back revision.
-- The payload carries no lot data (public fields are read by the listener). Reverse: down/007_availability_notify.down.sql
CREATE FUNCTION plat_notify_availability_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('plat_availability', json_build_object('developmentId', NEW.id, 'revision', NEW.availability_revision)::text);
  RETURN NULL;
END;
$$;

CREATE TRIGGER developments_availability_revision_notify
  AFTER UPDATE OF availability_revision ON developments
  FOR EACH ROW WHEN (NEW.availability_revision IS DISTINCT FROM OLD.availability_revision)
  EXECUTE FUNCTION plat_notify_availability_revision();

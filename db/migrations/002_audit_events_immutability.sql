-- Enforce audit_events immutability at the database layer (bank-readiness
-- audit finding BR-005, previously "Open").
--
-- A trigger is used instead of REVOKE UPDATE/DELETE: the application role
-- is the owner of this table (it ran the migration that created it), and in
-- PostgreSQL a table's owner always retains full privileges on objects they
-- own regardless of GRANT/REVOKE — ownership bypasses the ACL check
-- entirely. A BEFORE UPDATE/DELETE trigger, by contrast, fires
-- unconditionally for every role, including the owner and any future
-- superuser connection, so it is the only mechanism that actually blocks an
-- in-place edit or deletion of an existing audit row. INSERT is untouched.
CREATE FUNCTION audit_events_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events rows are append-only: % is not permitted (id=%)', TG_OP, COALESCE(OLD.id, 'unknown')
    USING ERRCODE = 'raise_exception';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_no_update
  BEFORE UPDATE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_block_mutation();

CREATE TRIGGER audit_events_no_delete
  BEFORE DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_block_mutation();

-- Isolasi kantor dengan row-level security + hak akses role aplikasi.
-- Role aplikasi `notaris_app` dibuat oleh skrip migrasi (bukan pemilik tabel),
-- sehingga RLS selalu berlaku untuk koneksi aplikasi.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'clients', 'client_otps', 'matter_code_counters', 'matters', 'matter_parties',
    'matter_assignments', 'documents', 'templates', 'deed_drafts', 'register_counters',
    'deeds', 'appointments', 'invoices', 'payments', 'audit_log'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY office_isolation ON %I
         USING (office_id = nullif(current_setting(''app.office_id'', true), '''')::uuid)
         WITH CHECK (office_id = nullif(current_setting(''app.office_id'', true), '''')::uuid)',
      t);
  END LOOP;
END $$;

-- Hak dasar: baca + tulis, tanpa DELETE untuk data bisnis.
GRANT USAGE ON SCHEMA public TO notaris_app;
GRANT SELECT ON offices, roles TO notaris_app;
GRANT SELECT, INSERT, UPDATE ON users, sessions, data_keys TO notaris_app;
GRANT SELECT, INSERT, UPDATE ON
  clients, client_otps, matter_code_counters, matters, documents, templates,
  deed_drafts, register_counters, deeds, appointments, invoices, payments
TO notaris_app;
-- Relasi penugasan/pihak boleh dihapus (bukan data historis; perubahan tetap diaudit).
GRANT SELECT, INSERT, DELETE ON matter_parties, matter_assignments TO notaris_app;
-- Log audit hanya boleh ditambah dan dibaca.
GRANT SELECT, INSERT ON audit_log TO notaris_app;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM notaris_app;
-- Tabel internal worker.
GRANT SELECT, INSERT, UPDATE ON outbox, notifications TO notaris_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO notaris_app;

-- Login portal klien: cari klien berdasarkan email lintas kantor tanpa membuka RLS.
CREATE FUNCTION portal_find_client(p_email text)
RETURNS TABLE (client_id uuid, office_id uuid, full_name text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, c.office_id, c.full_name
    FROM clients c
   WHERE c.email = lower(p_email) AND c.archived_at IS NULL
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION portal_find_client(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION portal_find_client(text) TO notaris_app;

-- Riwayat perubahan berkas dan akta ditulis otomatis ke audit_log.
CREATE FUNCTION audit_row_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  changes jsonb := '{}'::jsonb;
  k text;
BEGIN
  FOR k IN SELECT jsonb_object_keys(to_jsonb(NEW)) LOOP
    IF k NOT LIKE '%\_enc' AND k NOT LIKE '%\_hash'
       AND k NOT IN ('updated_at', 'updated_by')
       AND (to_jsonb(OLD) -> k) IS DISTINCT FROM (to_jsonb(NEW) -> k) THEN
      changes := changes || jsonb_build_object(k, jsonb_build_object('from', to_jsonb(OLD) -> k, 'to', to_jsonb(NEW) -> k));
    END IF;
  END LOOP;
  IF changes <> '{}'::jsonb THEN
    INSERT INTO audit_log (office_id, actor_type, actor_id, action, entity, entity_id, detail)
    VALUES (NEW.office_id, 'staff',
            nullif(current_setting('app.actor_id', true), '')::uuid,
            TG_TABLE_NAME || '.changed', TG_TABLE_NAME, NEW.id::text, changes);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER matters_audit AFTER UPDATE ON matters FOR EACH ROW EXECUTE FUNCTION audit_row_change();
CREATE TRIGGER clients_audit AFTER UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION audit_row_change();
CREATE TRIGGER deeds_audit   AFTER UPDATE ON deeds   FOR EACH ROW EXECUTE FUNCTION audit_row_change();

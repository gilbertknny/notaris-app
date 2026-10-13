-- Skema inti aplikasi Notaris & PPAT.
-- Konvensi: snake_case, id uuid, office_id di setiap tabel bisnis, tidak ada DELETE untuk data bisnis.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE party_type    AS ENUM ('person', 'company');
CREATE TYPE matter_status AS ENUM ('intake', 'documents', 'drafting', 'review',
                                   'scheduled', 'signed', 'filing', 'done', 'cancelled');
CREATE TYPE register_type AS ENUM ('repertorium', 'legalisasi', 'waarmerking', 'ppat');
CREATE TYPE draft_status  AS ENUM ('draft', 'submitted', 'approved', 'returned');

-- ---------------------------------------------------------------------------
-- Tabel global (dibaca sebelum kantor diketahui, mis. saat login)
-- ---------------------------------------------------------------------------
CREATE TABLE offices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  notary_name  text NOT NULL,
  region_code  text NOT NULL,
  timezone     text NOT NULL DEFAULT 'Asia/Jakarta',
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE roles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id    uuid NOT NULL REFERENCES offices(id),
  code         text NOT NULL,
  name         text NOT NULL,
  permissions  text[] NOT NULL DEFAULT '{}',
  UNIQUE (office_id, code)
);

CREATE TABLE users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id        uuid NOT NULL REFERENCES offices(id),
  email            text NOT NULL UNIQUE CHECK (email = lower(email)),
  full_name        text NOT NULL,
  password_hash    text NOT NULL,
  role_id          uuid NOT NULL REFERENCES roles(id),
  mfa_secret_enc   bytea,
  mfa_enabled      boolean NOT NULL DEFAULT false,
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Data key per kantor, dibungkus kunci induk (envelope encryption).
CREATE TABLE data_keys (
  office_id    uuid PRIMARY KEY REFERENCES offices(id),
  wrapped_key  bytea NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash       bytea NOT NULL UNIQUE,
  kind             text NOT NULL CHECK (kind IN ('staff', 'client')),
  office_id        uuid NOT NULL REFERENCES offices(id),
  user_id          uuid REFERENCES users(id),
  client_id        uuid,
  mfa_verified_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  revoked_at       timestamptz,
  ip               inet,
  user_agent       text,
  CHECK ((kind = 'staff' AND user_id IS NOT NULL) OR (kind = 'client' AND client_id IS NOT NULL))
);
CREATE INDEX sessions_user_idx ON sessions (user_id) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- Tabel bisnis (dilindungi row-level security per kantor, lihat 002_rls.sql)
-- ---------------------------------------------------------------------------
CREATE TABLE clients (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id    uuid NOT NULL REFERENCES offices(id),
  type         party_type NOT NULL,
  full_name    text NOT NULL,
  nik_enc      bytea,
  nik_hash     bytea,
  npwp_enc     bytea,
  npwp_hash    bytea,
  birth_date   date,
  address_enc  bytea,
  phone        text,
  email        text CHECK (email IS NULL OR email = lower(email)),
  kyc_risk     text CHECK (kyc_risk IN ('low', 'medium', 'high')),
  archived_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES users(id),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid REFERENCES users(id),
  UNIQUE (office_id, nik_hash),
  UNIQUE (office_id, email)
);
CREATE INDEX clients_name_trgm ON clients USING gin (full_name gin_trgm_ops);

CREATE TABLE client_otps (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id   uuid NOT NULL REFERENCES offices(id),
  client_id   uuid NOT NULL REFERENCES clients(id),
  code_hash   bytea NOT NULL,
  expires_at  timestamptz NOT NULL,
  attempts    int NOT NULL DEFAULT 0,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE matter_code_counters (
  office_id    uuid NOT NULL REFERENCES offices(id),
  period       date NOT NULL,
  last_number  int  NOT NULL DEFAULT 0,
  PRIMARY KEY (office_id, period)
);

CREATE TABLE matters (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id     uuid NOT NULL REFERENCES offices(id),
  code          text NOT NULL,
  service_type  text NOT NULL,
  title         text NOT NULL,
  status        matter_status NOT NULL DEFAULT 'intake',
  owner_id      uuid NOT NULL REFERENCES users(id),
  due_date      date,
  is_sensitive  boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES users(id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid REFERENCES users(id),
  UNIQUE (office_id, code)
);
CREATE INDEX matters_status_idx ON matters (office_id, status, due_date);

CREATE TABLE matter_parties (
  office_id  uuid NOT NULL REFERENCES offices(id),
  matter_id  uuid NOT NULL REFERENCES matters(id),
  client_id  uuid NOT NULL REFERENCES clients(id),
  role       text NOT NULL,
  PRIMARY KEY (matter_id, client_id, role)
);
CREATE INDEX matter_parties_client_idx ON matter_parties (client_id);

CREATE TABLE matter_assignments (
  office_id  uuid NOT NULL REFERENCES offices(id),
  matter_id  uuid NOT NULL REFERENCES matters(id),
  user_id    uuid NOT NULL REFERENCES users(id),
  PRIMARY KEY (matter_id, user_id)
);
CREATE INDEX matter_assignments_user_idx ON matter_assignments (user_id);

CREATE TABLE documents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id           uuid NOT NULL REFERENCES offices(id),
  matter_id           uuid REFERENCES matters(id),
  client_id           uuid REFERENCES clients(id),
  kind                text NOT NULL,
  filename            text NOT NULL,
  mime                text NOT NULL,
  size_bytes          bigint NOT NULL,
  storage_key         text NOT NULL,
  sha256              bytea NOT NULL,
  version             int NOT NULL DEFAULT 1,
  status              text NOT NULL DEFAULT 'pending_scan'
                        CHECK (status IN ('pending_scan', 'ready', 'quarantined')),
  uploaded_by_user    uuid REFERENCES users(id),
  uploaded_by_client  uuid REFERENCES clients(id),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX documents_matter_idx ON documents (matter_id);

CREATE TABLE templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id     uuid NOT NULL REFERENCES offices(id),
  code          text NOT NULL,
  name          text NOT NULL,
  service_type  text NOT NULL,
  body          text NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (office_id, code)
);

CREATE TABLE deed_drafts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id     uuid NOT NULL REFERENCES offices(id),
  matter_id     uuid NOT NULL REFERENCES matters(id),
  template_id   uuid NOT NULL REFERENCES templates(id),
  version       int NOT NULL,
  status        draft_status NOT NULL DEFAULT 'draft',
  content       text NOT NULL,
  return_note   text,
  submitted_at  timestamptz,
  approved_by   uuid REFERENCES users(id),
  approved_at   timestamptz,
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (matter_id, version)
);

CREATE TABLE register_counters (
  office_id    uuid NOT NULL REFERENCES offices(id),
  register     register_type NOT NULL,
  period       date NOT NULL,
  last_number  int NOT NULL DEFAULT 0,
  locked_at    timestamptz,
  locked_by    uuid REFERENCES users(id),
  PRIMARY KEY (office_id, register, period)
);

CREATE TABLE deeds (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id   uuid NOT NULL REFERENCES offices(id),
  matter_id   uuid NOT NULL REFERENCES matters(id),
  draft_id    uuid NOT NULL UNIQUE REFERENCES deed_drafts(id),
  register    register_type NOT NULL,
  number      int NOT NULL CHECK (number > 0),
  period      date NOT NULL,
  signed_at   timestamptz NOT NULL,
  title       text NOT NULL,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (office_id, register, period, number)
);

CREATE TABLE appointments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id   uuid NOT NULL REFERENCES offices(id),
  matter_id   uuid NOT NULL REFERENCES matters(id),
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL CHECK (ends_at > starts_at),
  room        text,
  note        text,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz
);
CREATE INDEX appointments_time_idx ON appointments (office_id, starts_at);

CREATE TABLE invoices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id    uuid NOT NULL REFERENCES offices(id),
  matter_id    uuid NOT NULL REFERENCES matters(id),
  number       text NOT NULL,
  description  text,
  amount       numeric(18,2) NOT NULL CHECK (amount > 0),
  tax_escrow   numeric(18,2) NOT NULL DEFAULT 0 CHECK (tax_escrow >= 0),
  status       text NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'partial', 'paid', 'void')),
  issued_at    timestamptz NOT NULL DEFAULT now(),
  due_date     date,
  created_by   uuid REFERENCES users(id),
  UNIQUE (office_id, number)
);

CREATE TABLE payments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id   uuid NOT NULL REFERENCES offices(id),
  invoice_id  uuid NOT NULL REFERENCES invoices(id),
  amount      numeric(18,2) NOT NULL CHECK (amount > 0),
  method      text NOT NULL,
  reference   text,
  paid_at     timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES users(id)
);

-- Log audit: append-only (UPDATE/DELETE dicabut di 002_rls.sql).
CREATE TABLE audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  office_id   uuid NOT NULL,
  actor_type  text NOT NULL CHECK (actor_type IN ('staff', 'client', 'system')),
  actor_id    uuid,
  action      text NOT NULL,
  entity      text NOT NULL,
  entity_id   text,
  ip          inet,
  at          timestamptz NOT NULL DEFAULT now(),
  detail      jsonb
);
CREATE INDEX audit_log_office_at_idx ON audit_log (office_id, at DESC);
CREATE INDEX audit_log_entity_idx ON audit_log (entity, entity_id);

-- Outbox: event domain ditulis di transaksi yang sama, diproses worker.
CREATE TABLE outbox (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  office_id     uuid NOT NULL,
  topic         text NOT NULL,
  payload       jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  available_at  timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz,
  attempts      int NOT NULL DEFAULT 0,
  last_error    text
);
CREATE INDEX outbox_pending_idx ON outbox (available_at) WHERE processed_at IS NULL;

-- Notifikasi yang sudah "dikirim" (dev: hanya dicatat; produksi: adapter WA/email).
CREATE TABLE notifications (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  office_id   uuid NOT NULL,
  channel     text NOT NULL,
  recipient   text NOT NULL,
  template    text NOT NULL,
  body        text NOT NULL,
  sent_at     timestamptz NOT NULL DEFAULT now()
);

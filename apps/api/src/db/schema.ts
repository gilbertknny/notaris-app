import type { ColumnType, Generated } from 'kysely';
import type { DraftStatus, MatterStatus, RegisterType } from '@notaris/shared';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type CreatedAt = ColumnType<Date, Date | string | undefined, never>;
type Numeric = ColumnType<string, number | string, number | string>;
type DateOnly = ColumnType<string, string, string>;

export interface OfficesTable {
  id: Generated<string>;
  name: string;
  notary_name: string;
  region_code: string;
  timezone: Generated<string>;
  created_at: CreatedAt;
}

export interface RolesTable {
  id: Generated<string>;
  office_id: string;
  code: string;
  name: string;
  permissions: string[];
}

export interface UsersTable {
  id: Generated<string>;
  office_id: string;
  email: string;
  full_name: string;
  password_hash: string;
  role_id: string;
  mfa_secret_enc: Buffer | null;
  mfa_enabled: Generated<boolean>;
  active: Generated<boolean>;
  created_at: CreatedAt;
}

export interface DataKeysTable {
  office_id: string;
  wrapped_key: Buffer;
  created_at: CreatedAt;
}

export interface SessionsTable {
  id: Generated<string>;
  token_hash: Buffer;
  kind: 'staff' | 'client';
  office_id: string;
  user_id: string | null;
  client_id: string | null;
  mfa_verified_at: Timestamp | null;
  created_at: CreatedAt;
  last_seen_at: Timestamp;
  expires_at: Timestamp;
  revoked_at: Timestamp | null;
  ip: string | null;
  user_agent: string | null;
}

export interface ClientsTable {
  id: Generated<string>;
  office_id: string;
  type: 'person' | 'company';
  full_name: string;
  nik_enc: Buffer | null;
  nik_hash: Buffer | null;
  npwp_enc: Buffer | null;
  npwp_hash: Buffer | null;
  birth_date: DateOnly | null;
  address_enc: Buffer | null;
  phone: string | null;
  email: string | null;
  kyc_risk: 'low' | 'medium' | 'high' | null;
  archived_at: Timestamp | null;
  created_at: CreatedAt;
  created_by: string | null;
  updated_at: Timestamp;
  updated_by: string | null;
}

export interface ClientOtpsTable {
  id: Generated<string>;
  office_id: string;
  client_id: string;
  code_hash: Buffer;
  expires_at: Timestamp;
  attempts: Generated<number>;
  used_at: Timestamp | null;
  created_at: CreatedAt;
}

export interface MatterCodeCountersTable {
  office_id: string;
  period: DateOnly;
  last_number: Generated<number>;
}

export interface MattersTable {
  id: Generated<string>;
  office_id: string;
  code: string;
  service_type: string;
  title: string;
  status: Generated<MatterStatus>;
  owner_id: string;
  due_date: DateOnly | null;
  is_sensitive: Generated<boolean>;
  created_at: CreatedAt;
  created_by: string | null;
  updated_at: Timestamp;
  updated_by: string | null;
}

export interface MatterPartiesTable {
  office_id: string;
  matter_id: string;
  client_id: string;
  role: string;
}

export interface MatterAssignmentsTable {
  office_id: string;
  matter_id: string;
  user_id: string;
}

export interface DocumentsTable {
  id: Generated<string>;
  office_id: string;
  matter_id: string | null;
  client_id: string | null;
  kind: string;
  filename: string;
  mime: string;
  size_bytes: ColumnType<string, number, number>;
  storage_key: string;
  sha256: Buffer;
  version: Generated<number>;
  status: Generated<'pending_scan' | 'ready' | 'quarantined'>;
  uploaded_by_user: string | null;
  uploaded_by_client: string | null;
  created_at: CreatedAt;
}

export interface TemplatesTable {
  id: Generated<string>;
  office_id: string;
  code: string;
  name: string;
  service_type: string;
  body: string;
  active: Generated<boolean>;
  created_at: CreatedAt;
}

export interface DeedDraftsTable {
  id: Generated<string>;
  office_id: string;
  matter_id: string;
  template_id: string;
  version: number;
  status: Generated<DraftStatus>;
  content: string;
  return_note: string | null;
  submitted_at: Timestamp | null;
  approved_by: string | null;
  approved_at: Timestamp | null;
  created_by: string | null;
  created_at: CreatedAt;
  updated_at: Timestamp;
}

export interface RegisterCountersTable {
  office_id: string;
  register: RegisterType;
  period: DateOnly;
  last_number: Generated<number>;
  locked_at: Timestamp | null;
  locked_by: string | null;
}

export interface DeedsTable {
  id: Generated<string>;
  office_id: string;
  matter_id: string;
  draft_id: string;
  register: RegisterType;
  number: number;
  period: DateOnly;
  signed_at: Timestamp;
  title: string;
  created_by: string | null;
  created_at: CreatedAt;
}

export interface AppointmentsTable {
  id: Generated<string>;
  office_id: string;
  matter_id: string;
  starts_at: Timestamp;
  ends_at: Timestamp;
  room: string | null;
  note: string | null;
  created_by: string | null;
  created_at: CreatedAt;
  cancelled_at: Timestamp | null;
}

export interface InvoicesTable {
  id: Generated<string>;
  office_id: string;
  matter_id: string;
  number: string;
  description: string | null;
  amount: Numeric;
  tax_escrow: Numeric;
  status: Generated<'unpaid' | 'partial' | 'paid' | 'void'>;
  issued_at: Timestamp;
  due_date: DateOnly | null;
  created_by: string | null;
}

export interface PaymentsTable {
  id: Generated<string>;
  office_id: string;
  invoice_id: string;
  amount: Numeric;
  method: string;
  reference: string | null;
  paid_at: Timestamp;
  created_by: string | null;
}

export interface AuditLogTable {
  id: Generated<string>;
  office_id: string;
  actor_type: 'staff' | 'client' | 'system';
  actor_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  ip: string | null;
  at: CreatedAt;
  detail: ColumnType<unknown, string | null, never> | null;
}

export interface OutboxTable {
  id: Generated<string>;
  office_id: string;
  topic: string;
  payload: ColumnType<Record<string, unknown>, string, string>;
  created_at: CreatedAt;
  available_at: Timestamp;
  processed_at: Timestamp | null;
  attempts: Generated<number>;
  last_error: string | null;
}

export interface NotificationsTable {
  id: Generated<string>;
  office_id: string;
  channel: string;
  recipient: string;
  template: string;
  body: string;
  sent_at: CreatedAt;
}

export interface DB {
  offices: OfficesTable;
  roles: RolesTable;
  users: UsersTable;
  data_keys: DataKeysTable;
  sessions: SessionsTable;
  clients: ClientsTable;
  client_otps: ClientOtpsTable;
  matter_code_counters: MatterCodeCountersTable;
  matters: MattersTable;
  matter_parties: MatterPartiesTable;
  matter_assignments: MatterAssignmentsTable;
  documents: DocumentsTable;
  templates: TemplatesTable;
  deed_drafts: DeedDraftsTable;
  register_counters: RegisterCountersTable;
  deeds: DeedsTable;
  appointments: AppointmentsTable;
  invoices: InvoicesTable;
  payments: PaymentsTable;
  audit_log: AuditLogTable;
  outbox: OutboxTable;
  notifications: NotificationsTable;
}

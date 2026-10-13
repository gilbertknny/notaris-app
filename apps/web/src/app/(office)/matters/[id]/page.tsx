'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DOCUMENT_KINDS, DRAFT_STATUS_LABEL, DraftStatus, MatterStatus, REGISTER_LABEL, REGISTER_TYPES, SERVICE_TYPES } from '@notaris/shared';
import { api, errorText } from '@/lib/api';
import { aksi, rupiah, tanggal, ukuran, waktu } from '@/lib/format';
import { useCan } from '@/lib/session';
import { Button, Empty, ErrorBox, Field, Input, Loading, Modal, Notice, PageHeader, Pill, Select, StatusRail, Table, Tabs, td } from '@/components/ui';

interface Matter {
  id: string;
  code: string;
  title: string;
  serviceType: keyof typeof SERVICE_TYPES;
  status: MatterStatus;
  dueDate: string | null;
  isSensitive: boolean;
  owner: { id: string; fullName: string };
  parties: { id: string; fullName: string; type: string; role: string; nikMasked: string | null; phone: string | null; email: string | null }[];
  assignees: { id: string; fullName: string }[];
  documents: { id: string; kind: string; filename: string; sizeBytes: string; status: 'pending_scan' | 'ready' | 'quarantined'; version: number; createdAt: string; uploadedByClient: string | null }[];
  drafts: { id: string; version: number; status: DraftStatus; returnNote: string | null; createdAt: string; templateName: string }[];
  deeds: { id: string; register: keyof typeof REGISTER_LABEL; number: number; period: string; signedAt: string; title: string }[];
  invoices: { id: string; number: string; amount: string; taxEscrow: string; status: string; dueDate: string | null; description: string | null }[];
  appointments: { id: string; startsAt: string; endsAt: string; room: string | null; note: string | null }[];
  history: { id: string; action: string; at: string; actorName: string | null; actorType: string; detail: Record<string, unknown> | null }[];
  nextStatuses: MatterStatus[];
}

const TRANSITION_LABEL: Partial<Record<MatterStatus, string>> = {
  documents: 'Mulai kumpulkan dokumen',
  drafting: 'Dokumen lengkap, mulai susun draf',
  filing: 'Ajukan ke instansi',
  done: 'Tandai selesai',
};

type Tab = 'summary' | 'documents' | 'drafts' | 'schedule' | 'billing' | 'history';

function MatterDetail() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const can = useCan();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>((params.get('tab') as Tab) ?? 'summary');
  const [numberOpen, setNumberOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const { data: m, isLoading, error } = useQuery({ queryKey: ['matter', id], queryFn: () => api<Matter>(`/matters/${id}`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['matter', id] });

  const transition = useMutation({
    mutationFn: (to: MatterStatus) => api(`/matters/${id}/transition`, { body: { to } }),
    onSuccess: () => {
      setCancelOpen(false);
      refresh();
    },
  });

  if (error) return <ErrorBox>{errorText(error)}</ErrorBox>;
  if (isLoading || !m) return <Loading />;

  const forward = m.nextStatuses.filter((s) => s !== 'cancelled');
  return (
    <>
      <PageHeader
        title={m.title}
        description={
          <>
            {m.code} · {SERVICE_TYPES[m.serviceType] ?? m.serviceType} · penanggung jawab {m.owner.fullName}
            {m.dueDate && <> · tenggat {tanggal(m.dueDate)}</>}
            {m.isSensitive && <span className="ml-2 text-bad">Berkas sensitif</span>}
          </>
        }
        actions={
          <>
            {can('matter.transition') &&
              forward.map((s) => (
                <Button key={s} variant="secondary" onClick={() => transition.mutate(s)} disabled={transition.isPending}>
                  {TRANSITION_LABEL[s] ?? s}
                </Button>
              ))}
            {m.status === 'drafting' && can('draft.write') && (
              <Button variant="secondary" onClick={() => setTab('drafts')}>
                Susun draf
              </Button>
            )}
            {m.status === 'scheduled' && can('deed.number') && <Button onClick={() => setNumberOpen(true)}>Tanda tangan & beri nomor</Button>}
          </>
        }
      />

      <section className="mb-8 rounded-lg border border-rule bg-sheet px-5 py-5">
        <StatusRail status={m.status} />
      </section>
      <ErrorBox>{transition.error && errorText(transition.error)}</ErrorBox>

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        items={[
          { id: 'summary', label: 'Ringkasan' },
          { id: 'documents', label: 'Dokumen', count: m.documents.length },
          { id: 'drafts', label: 'Draf & akta', count: m.drafts.length },
          { id: 'schedule', label: 'Jadwal', count: m.appointments.length },
          { id: 'billing', label: 'Tagihan', count: m.invoices.length },
          { id: 'history', label: 'Riwayat' },
        ]}
      />

      {tab === 'summary' && <Summary m={m} onChange={refresh} />}
      {tab === 'documents' && <Documents m={m} onChange={refresh} />}
      {tab === 'drafts' && <Drafts m={m} onChange={refresh} />}
      {tab === 'schedule' && <Schedule m={m} onChange={refresh} />}
      {tab === 'billing' && <Billing m={m} onChange={refresh} />}
      {tab === 'history' && <History m={m} />}

      {can('matter.transition') && m.nextStatuses.includes('cancelled') && (
        <div className="mt-12 border-t border-rule pt-5">
          <Button variant="danger" onClick={() => setCancelOpen(true)}>
            Batalkan berkas
          </Button>
        </div>
      )}

      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title="Batalkan berkas ini?">
        <p className="mb-5 text-sm text-ink-soft">Berkas yang dibatalkan tidak bisa dilanjutkan. Data dan riwayat tetap tersimpan.</p>
        <div className="flex justify-end gap-2">
          <Button variant="quiet" onClick={() => setCancelOpen(false)}>
            Kembali
          </Button>
          <Button variant="danger" onClick={() => transition.mutate('cancelled')} disabled={transition.isPending}>
            Batalkan berkas
          </Button>
        </div>
      </Modal>
      <NumberDeed open={numberOpen} onClose={() => setNumberOpen(false)} m={m} onDone={refresh} />
    </>
  );
}

function Summary({ m, onChange }: { m: Matter; onChange: () => void }) {
  const can = useCan();
  const [revealed, setRevealed] = useState<Record<string, { nik: string | null; npwp: string | null; address: string | null }>>({});
  const [assignee, setAssignee] = useState('');
  const users = useQuery({
    queryKey: ['users'],
    queryFn: () => api<{ id: string; fullName: string; active: boolean; roleName: string }[]>('/users'),
    enabled: can('matter.assign'),
  });
  const reveal = useMutation({
    mutationFn: (clientId: string) => api<{ nik: string | null; npwp: string | null; address: string | null }>(`/clients/${clientId}/reveal`, { method: 'POST' }),
    onSuccess: (data, clientId) => setRevealed((r) => ({ ...r, [clientId]: data })),
  });
  const assign = useMutation({
    mutationFn: () => api(`/matters/${m.id}/assign`, { body: { userId: assignee } }),
    onSuccess: () => {
      setAssignee('');
      onChange();
    },
  });
  const unassign = useMutation({ mutationFn: (userId: string) => api(`/matters/${m.id}/assign/${userId}`, { method: 'DELETE' }), onSuccess: onChange });

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
      <section>
        <h2 className="mb-3 font-semibold">Pihak</h2>
        <ErrorBox>{reveal.error && errorText(reveal.error)}</ErrorBox>
        <ul className="divide-y divide-rule rounded-lg border border-rule bg-sheet">
          {m.parties.map((p) => (
            <li key={`${p.id}-${p.role}`} className="px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link href={`/clients/${p.id}`} className="font-medium hover:text-stamp">
                  {p.fullName}
                </Link>
                <Pill>{p.role}</Pill>
              </div>
              <dl className="mt-1 grid gap-x-6 text-sm text-ink-soft sm:grid-cols-2">
                <div>
                  <dt className="inline">NIK </dt>
                  <dd className="inline tabular-nums text-ink">{revealed[p.id]?.nik ?? p.nikMasked ?? '—'}</dd>
                  {p.nikMasked && !revealed[p.id] && can('client.reveal') && (
                    <button className="ml-2 text-stamp underline underline-offset-2" onClick={() => reveal.mutate(p.id)}>
                      Tampilkan
                    </button>
                  )}
                </div>
                <div>{p.phone ?? p.email ?? ''}</div>
                {revealed[p.id]?.address && <div className="sm:col-span-2">Alamat: {revealed[p.id].address}</div>}
              </dl>
            </li>
          ))}
        </ul>
        {Object.keys(revealed).length > 0 && <p className="mt-2 text-xs text-ink-faint">Pembukaan data identitas tercatat di log audit.</p>}
      </section>

      <section>
        <h2 className="mb-3 font-semibold">Staf yang ditugaskan</h2>
        <ul className="mb-3 divide-y divide-rule rounded-lg border border-rule bg-sheet">
          {m.assignees.map((a) => (
            <li key={a.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
              {a.fullName}
              {a.id === m.owner.id ? (
                <span className="text-xs text-ink-faint">penanggung jawab</span>
              ) : (
                can('matter.assign') && (
                  <button className="text-xs text-ink-soft hover:text-bad" onClick={() => unassign.mutate(a.id)}>
                    Lepas
                  </button>
                )
              )}
            </li>
          ))}
        </ul>
        {can('matter.assign') && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              assign.mutate();
            }}
          >
            <Select value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="Pilih staf">
              <option value="">Pilih staf…</option>
              {users.data
                ?.filter((u) => u.active && !m.assignees.some((a) => a.id === u.id))
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName} ({u.roleName})
                  </option>
                ))}
            </Select>
            <Button type="submit" variant="secondary" disabled={!assignee || assign.isPending}>
              Tugaskan
            </Button>
          </form>
        )}
      </section>
    </div>
  );
}

function Documents({ m, onChange }: { m: Matter; onChange: () => void }) {
  const can = useCan();
  const [kind, setKind] = useState('ktp');
  const [file, setFile] = useState<File | null>(null);
  const upload = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append('kind', kind);
      form.append('file', file!);
      return api(`/matters/${m.id}/documents`, { form });
    },
    onSuccess: () => {
      setFile(null);
      onChange();
      setTimeout(onChange, 3000); // status pemindaian biasanya selesai dalam beberapa detik
    },
  });
  const open = useMutation({
    mutationFn: (docId: string) => api<{ url: string }>(`/documents/${docId}/link`),
    onSuccess: (r) => window.open(r.url, '_blank', 'noopener'),
  });

  return (
    <div className="space-y-6">
      {can('document.write') && (
        <form
          className="flex flex-wrap items-end gap-3 rounded-lg border border-rule bg-sheet p-4"
          onSubmit={(e) => {
            e.preventDefault();
            upload.mutate();
          }}
        >
          <Field label="Jenis dokumen">
            <Select value={kind} onChange={(e) => setKind(e.target.value)}>
              {Object.entries(DOCUMENT_KINDS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="File" hint="PDF, JPG, atau PNG, maksimal 15 MB">
            <Input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="py-1.5" />
          </Field>
          <Button type="submit" disabled={!file || upload.isPending}>
            Unggah
          </Button>
          <div className="w-full">
            <ErrorBox>{upload.error && errorText(upload.error)}</ErrorBox>
          </div>
        </form>
      )}
      <ErrorBox>{open.error && errorText(open.error)}</ErrorBox>
      {m.documents.length === 0 ? (
        <Empty title="Belum ada dokumen">Unggah KTP, sertifikat, atau dokumen pendukung lain untuk berkas ini.</Empty>
      ) : (
        <Table head={['Jenis', 'File', 'Diunggah', 'Status', '']}>
          {m.documents.map((d) => (
            <tr key={d.id}>
              <td className={td}>
                {DOCUMENT_KINDS[d.kind as keyof typeof DOCUMENT_KINDS] ?? d.kind}
                {d.version > 1 && <span className="ml-1 text-xs text-ink-faint">v{d.version}</span>}
              </td>
              <td className={`${td} text-ink-soft`}>
                {d.filename} <span className="text-ink-faint">({ukuran(d.sizeBytes)})</span>
              </td>
              <td className={`${td} whitespace-nowrap text-ink-soft`}>
                {waktu(d.createdAt)}
                {d.uploadedByClient && <span className="block text-xs">oleh klien</span>}
              </td>
              <td className={td}>
                {d.status === 'ready' ? <Pill tone="ok">Siap</Pill> : d.status === 'pending_scan' ? <Pill tone="warn">Dipindai</Pill> : <Pill tone="bad">Dikarantina</Pill>}
              </td>
              <td className={`${td} text-right`}>
                {d.status === 'ready' && (
                  <Button variant="quiet" onClick={() => open.mutate(d.id)}>
                    Buka
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

function Drafts({ m, onChange }: { m: Matter; onChange: () => void }) {
  const can = useCan();
  const [templateId, setTemplateId] = useState('');
  const templates = useQuery({
    queryKey: ['templates', m.serviceType],
    queryFn: () => api<{ id: string; name: string; serviceType: string }[]>(`/templates`),
    enabled: can('draft.write'),
  });
  const create = useMutation({
    mutationFn: () => api<{ id: string }>(`/matters/${m.id}/drafts`, { body: { templateId } }),
    onSuccess: (d) => {
      onChange();
      window.location.href = `/drafts/${d.id}`;
    },
  });
  const sorted = [...(templates.data ?? [])].sort((a, b) => Number(b.serviceType === m.serviceType) - Number(a.serviceType === m.serviceType));
  const canCreate = m.status === 'drafting' && can('draft.write') && !m.drafts.some((d) => d.status === 'draft');

  return (
    <div className="space-y-6">
      {m.deeds.map((d) => (
        <div key={d.id} className="flex flex-wrap items-center gap-4 rounded-lg border border-ok/25 bg-ok-soft px-5 py-4">
          <span className="stamp rounded-sm border-2 border-ok px-2 py-0.5 font-semibold text-ok">Nomor {d.number}</span>
          <span>
            <span className="block font-medium">{d.title}</span>
            <span className="text-sm text-ink-soft">
              {REGISTER_LABEL[d.register]} · ditandatangani {waktu(d.signedAt)}
            </span>
          </span>
        </div>
      ))}

      {canCreate && (
        <form
          className="flex flex-wrap items-end gap-3 rounded-lg border border-rule bg-sheet p-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Field label="Template" hint="Isian nama, NIK, dan alamat pihak diisi otomatis">
            <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="min-w-[260px]">
              <option value="">Pilih template…</option>
              {sorted.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" disabled={!templateId || create.isPending}>
            Buat draf
          </Button>
          <div className="w-full">
            <ErrorBox>{create.error && errorText(create.error)}</ErrorBox>
          </div>
        </form>
      )}
      {m.status !== 'drafting' && m.drafts.length === 0 && <Notice>Draf bisa disusun setelah berkas masuk tahap Penyusunan.</Notice>}

      {m.drafts.length > 0 && (
        <Table head={['Versi', 'Template', 'Dibuat', 'Status', '']}>
          {m.drafts.map((d) => (
            <tr key={d.id}>
              <td className={`${td} font-medium`}>v{d.version}</td>
              <td className={td}>{d.templateName}</td>
              <td className={`${td} text-ink-soft`}>{waktu(d.createdAt)}</td>
              <td className={td}>
                <Pill tone={d.status === 'approved' ? 'ok' : d.status === 'returned' ? 'bad' : d.status === 'submitted' ? 'stamp' : 'neutral'}>{DRAFT_STATUS_LABEL[d.status]}</Pill>
                {d.returnNote && <span className="mt-1 block text-xs text-bad">Catatan: {d.returnNote}</span>}
              </td>
              <td className={`${td} text-right`}>
                <Link href={`/drafts/${d.id}`} className="text-sm font-medium text-stamp hover:underline">
                  Buka
                </Link>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

function Schedule({ m, onChange }: { m: Matter; onChange: () => void }) {
  const can = useCan();
  const [date, setDate] = useState('');
  const [start, setStart] = useState('10:00');
  const [end, setEnd] = useState('11:00');
  const [room, setRoom] = useState('Ruang 1');
  const create = useMutation({
    mutationFn: () => api('/appointments', { body: { matterId: m.id, startsAt: `${date}T${start}:00+07:00`, endsAt: `${date}T${end}:00+07:00`, room } }),
    onSuccess: onChange,
  });
  const cancel = useMutation({ mutationFn: (apptId: string) => api(`/appointments/${apptId}/cancel`, { method: 'POST' }), onSuccess: onChange });

  return (
    <div className="space-y-6">
      {can('schedule.write') && !['signed', 'filing', 'done', 'cancelled'].includes(m.status) && (
        <form
          className="flex flex-wrap items-end gap-3 rounded-lg border border-rule bg-sheet p-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Field label="Tanggal">
            <Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Mulai (WIB)">
            <Input type="time" required value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Selesai">
            <Input type="time" required value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
          <Field label="Ruang">
            <Input value={room} onChange={(e) => setRoom(e.target.value)} />
          </Field>
          <Button type="submit" disabled={!date || create.isPending}>
            Jadwalkan
          </Button>
          <p className="w-full text-xs text-ink-faint">Para pihak menerima pemberitahuan lewat email atau WhatsApp.</p>
          <div className="w-full">
            <ErrorBox>{create.error && errorText(create.error)}</ErrorBox>
          </div>
        </form>
      )}
      {m.appointments.length === 0 ? (
        <Empty title="Belum ada jadwal penandatanganan" />
      ) : (
        <ul className="divide-y divide-rule rounded-lg border border-rule bg-sheet">
          {m.appointments.map((a) => (
            <li key={a.id} className="flex items-center justify-between px-4 py-3">
              <span>
                <span className="font-medium">{waktu(a.startsAt)}</span>
                <span className="text-ink-soft"> sampai {new Date(a.endsAt).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' })}</span>
                {a.room && <span className="text-ink-soft">, {a.room}</span>}
              </span>
              {can('schedule.write') && (
                <Button variant="quiet" onClick={() => cancel.mutate(a.id)}>
                  Batalkan jadwal
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Billing({ m, onChange }: { m: Matter; onChange: () => void }) {
  const can = useCan();
  const [amount, setAmount] = useState('');
  const [tax, setTax] = useState('');
  const [description, setDescription] = useState('Honorarium');
  const create = useMutation({
    mutationFn: () => api('/invoices', { body: { matterId: m.id, amount, taxEscrow: tax || 0, description } }),
    onSuccess: () => {
      setAmount('');
      setTax('');
      onChange();
    },
  });
  return (
    <div className="space-y-6">
      {can('finance.write') && m.status !== 'cancelled' && (
        <form
          className="flex flex-wrap items-end gap-3 rounded-lg border border-rule bg-sheet p-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Field label="Keterangan">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field label="Honorarium (Rp)">
            <Input inputMode="numeric" required value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field label="Titipan pajak (Rp)" hint="BPHTB/PPh yang dititipkan klien">
            <Input inputMode="numeric" value={tax} onChange={(e) => setTax(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Button type="submit" disabled={!amount || create.isPending}>
            Buat tagihan
          </Button>
          <div className="w-full">
            <ErrorBox>{create.error && errorText(create.error)}</ErrorBox>
          </div>
        </form>
      )}
      {m.invoices.length === 0 ? (
        <Empty title="Belum ada tagihan" />
      ) : (
        <Table head={['Nomor', 'Keterangan', 'Honorarium', 'Titipan pajak', 'Status']}>
          {m.invoices.map((i) => (
            <tr key={i.id}>
              <td className={`${td} tabular-nums`}>{i.number}</td>
              <td className={td}>{i.description ?? '—'}</td>
              <td className={`${td} tabular-nums`}>{rupiah(i.amount)}</td>
              <td className={`${td} tabular-nums`}>{rupiah(i.taxEscrow)}</td>
              <td className={td}>
                <Pill tone={i.status === 'paid' ? 'ok' : i.status === 'partial' ? 'warn' : 'neutral'}>{{ paid: 'Lunas', partial: 'Sebagian', unpaid: 'Belum dibayar', void: 'Batal' }[i.status] ?? i.status}</Pill>
              </td>
            </tr>
          ))}
        </Table>
      )}
      {can('finance.write') && (
        <p className="text-sm text-ink-soft">
          Pembayaran dicatat di halaman <Link href="/finance" className="text-stamp underline underline-offset-2">Keuangan</Link>.
        </p>
      )}
    </div>
  );
}

function History({ m }: { m: Matter }) {
  if (!m.history.length) return <Empty title="Belum ada riwayat" />;
  return (
    <ol className="space-y-0 border-l border-rule pl-5">
      {m.history.map((h) => (
        <li key={h.id} className="relative pb-5">
          <span className="absolute -left-[25px] top-1.5 h-2 w-2 rounded-full bg-ink-faint" />
          <p className="text-sm">
            <span className="font-medium">{h.actorName ?? (h.actorType === 'client' ? 'Klien' : 'Sistem')}</span> · {aksi(h.action)}
            {h.action === 'matters.changed' && h.detail && 'status' in h.detail && (
              <span className="text-ink-soft"> (status: {String((h.detail.status as { from: string; to: string }).from)} → {String((h.detail.status as { from: string; to: string }).to)})</span>
            )}
            {h.action === 'draft.returned' && h.detail?.note ? <span className="block text-ink-soft">Catatan: {String(h.detail.note)}</span> : null}
          </p>
          <p className="text-xs text-ink-faint">{waktu(h.at)}</p>
        </li>
      ))}
    </ol>
  );
}

function NumberDeed({ open, onClose, m, onDone }: { open: boolean; onClose: () => void; m: Matter; onDone: () => void }) {
  const [register, setRegister] = useState<(typeof REGISTER_TYPES)[number]>(['ajb', 'apht', 'hibah'].includes(m.serviceType) ? 'ppat' : 'repertorium');
  const [title, setTitle] = useState<string>(SERVICE_TYPES[m.serviceType] ?? '');
  const number = useMutation({
    mutationFn: () => api<{ number: number }>(`/matters/${m.id}/deeds`, { body: { register, title } }),
    onSuccess: () => {
      onClose();
      onDone();
    },
  });
  return (
    <Modal open={open} onClose={onClose} title="Tanda tangan & beri nomor akta">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          number.mutate();
        }}
      >
        <p className="text-sm text-ink-soft">
          Lakukan setelah semua pihak menandatangani minuta. Nomor diambil berurutan dan langsung tercatat di buku daftar bulan ini; tidak bisa dibatalkan.
        </p>
        <Field label="Buku daftar">
          <Select value={register} onChange={(e) => setRegister(e.target.value as typeof register)}>
            {REGISTER_TYPES.map((r) => (
              <option key={r} value={r}>
                {REGISTER_LABEL[r]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Sifat akta / judul">
          <Input required value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <ErrorBox>{number.error && errorText(number.error)}</ErrorBox>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="quiet" onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" disabled={number.isPending || title.trim().length < 3}>
            Beri nomor akta
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default function MatterPage() {
  return (
    <Suspense>
      <MatterDetail />
    </Suspense>
  );
}

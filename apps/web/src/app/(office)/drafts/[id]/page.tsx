'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DRAFT_STATUS_LABEL, DraftStatus, MatterStatus } from '@notaris/shared';
import { api, errorText } from '@/lib/api';
import { waktu } from '@/lib/format';
import { useCan } from '@/lib/session';
import { Button, ErrorBox, Field, Loading, Modal, Notice, Pill, Textarea } from '@/components/ui';

interface Draft {
  id: string;
  version: number;
  status: DraftStatus;
  content: string;
  returnNote: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  matter: { id: string; code: string; title: string; status: MatterStatus };
  versions: { id: string; version: number; status: DraftStatus }[];
}

export default function DraftPage() {
  const { id } = useParams<{ id: string }>();
  const can = useCan();
  const qc = useQueryClient();
  const { data: d, isLoading, error } = useQuery({ queryKey: ['draft', id], queryFn: () => api<Draft>(`/drafts/${id}`) });
  const [content, setContent] = useState('');
  const [returnOpen, setReturnOpen] = useState(false);
  const [note, setNote] = useState('');
  useEffect(() => {
    if (d) setContent(d.content);
  }, [d]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['draft', id] });
    if (d) qc.invalidateQueries({ queryKey: ['matter', d.matter.id] });
  };
  const save = useMutation({ mutationFn: () => api(`/drafts/${id}`, { method: 'PUT', body: { content } }), onSuccess: refresh });
  const submit = useMutation({
    mutationFn: async () => {
      if (content !== d?.content) await api(`/drafts/${id}`, { method: 'PUT', body: { content } });
      return api(`/drafts/${id}/submit`, { method: 'POST' });
    },
    onSuccess: refresh,
  });
  const approve = useMutation({ mutationFn: () => api(`/drafts/${id}/approve`, { method: 'POST' }), onSuccess: refresh });
  const reject = useMutation({
    mutationFn: () => api(`/drafts/${id}/return`, { body: { note } }),
    onSuccess: () => {
      setReturnOpen(false);
      refresh();
    },
  });

  if (error) return <ErrorBox>{errorText(error)}</ErrorBox>;
  if (isLoading || !d) return <Loading />;

  const editable = d.status === 'draft' && can('draft.write');
  const blanks = (content.match(/\[\[[^\]]+\]\]/g) ?? []).length;
  const dirty = content !== d.content;
  const mutationError = save.error ?? submit.error ?? approve.error;

  return (
    <>
      <header className="mb-6 border-b border-rule pb-5">
        <Link href={`/matters/${d.matter.id}?tab=drafts`} className="text-sm text-ink-soft hover:text-ink">
          {d.matter.code} · {d.matter.title}
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight">
            Draf versi {d.version}
            <Pill tone={d.status === 'approved' ? 'ok' : d.status === 'returned' ? 'bad' : d.status === 'submitted' ? 'stamp' : 'neutral'}>{DRAFT_STATUS_LABEL[d.status]}</Pill>
          </h1>
          <div className="flex flex-wrap gap-2">
            <a href={`/api/v1/drafts/${id}/download`} className="inline-flex h-9 items-center rounded-md border border-rule bg-sheet px-3.5 text-sm font-medium hover:border-ink-faint">
              Unduh
            </a>
            {editable && (
              <>
                <Button variant="secondary" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
                  Simpan
                </Button>
                <Button onClick={() => submit.mutate()} disabled={blanks > 0 || submit.isPending}>
                  Kirim ke Notaris
                </Button>
              </>
            )}
            {d.status === 'submitted' && can('draft.approve') && (
              <>
                <Button variant="secondary" onClick={() => setReturnOpen(true)}>
                  Kembalikan
                </Button>
                <Button onClick={() => approve.mutate()} disabled={approve.isPending}>
                  Setujui draf
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="grid gap-8 lg:grid-cols-[1fr_220px]">
        <div className="space-y-4">
          <ErrorBox>{mutationError && errorText(mutationError)}</ErrorBox>
          {d.returnNote && <ErrorBox>Dikembalikan Notaris: {d.returnNote}</ErrorBox>}
          {editable && blanks > 0 && <Notice>Masih ada {blanks} isian bertanda [[...]] yang perlu dilengkapi sebelum draf bisa dikirim.</Notice>}
          {d.status === 'submitted' && !can('draft.approve') && <Notice>Draf sedang menunggu persetujuan Notaris dan tidak bisa diubah.</Notice>}
          {d.status === 'approved' && <Notice>Draf disetujui {waktu(d.approvedAt)}. Akta bisa ditandatangani dan diberi nomor dari halaman berkas.</Notice>}
          <div className="rounded-lg border border-rule bg-sheet px-6 py-8 sm:px-12">
            {editable ? (
              <Textarea
                aria-label="Isi draf akta"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="deed-text min-h-[70vh] resize-y border-0 p-0 focus:ring-0"
                spellCheck
              />
            ) : (
              <div className="deed-text whitespace-pre-wrap">{d.content}</div>
            )}
          </div>
        </div>
        <aside>
          <h2 className="mb-2 text-sm font-semibold">Versi</h2>
          <ul className="space-y-1 text-sm">
            {d.versions.map((v) => (
              <li key={v.id}>
                <Link href={`/drafts/${v.id}`} className={`flex justify-between rounded px-2 py-1.5 ${v.id === d.id ? 'bg-stamp-soft font-medium' : 'hover:bg-sheet'}`}>
                  v{v.version} <span className="text-ink-faint">{DRAFT_STATUS_LABEL[v.status]}</span>
                </Link>
              </li>
            ))}
          </ul>
        </aside>
      </div>

      <Modal open={returnOpen} onClose={() => setReturnOpen(false)} title="Kembalikan draf ke penyusun">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            reject.mutate();
          }}
        >
          <Field label="Catatan perbaikan" error={reject.error && errorText(reject.error)}>
            <Textarea rows={4} required minLength={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="quiet" onClick={() => setReturnOpen(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={note.trim().length < 3 || reject.isPending}>
              Kembalikan draf
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

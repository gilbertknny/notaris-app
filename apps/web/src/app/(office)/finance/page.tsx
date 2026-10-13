'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorText } from '@/lib/api';
import { rupiah, tanggal } from '@/lib/format';
import { useCan } from '@/lib/session';
import { Button, Empty, ErrorBox, Field, Input, Loading, Modal, PageHeader, Pill, Select, Table, td } from '@/components/ui';

interface Invoice {
  id: string;
  number: string;
  amount: string;
  taxEscrow: string;
  status: 'unpaid' | 'partial' | 'paid' | 'void';
  issuedAt: string;
  dueDate: string | null;
  description: string | null;
  matterId: string;
  matterCode: string;
  matterTitle: string;
  paid: string;
}

const STATUS = { unpaid: 'Belum dibayar', partial: 'Sebagian', paid: 'Lunas', void: 'Batal' } as const;

export default function FinancePage() {
  const can = useCan();
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [paying, setPaying] = useState<Invoice | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['invoices', status], queryFn: () => api<Invoice[]>(`/invoices${status ? `?status=${status}` : ''}`) });
  const outstanding = (data ?? []).filter((i) => i.status !== 'paid' && i.status !== 'void').reduce((s, i) => s + Number(i.amount) + Number(i.taxEscrow) - Number(i.paid), 0);

  return (
    <>
      <PageHeader title="Keuangan" description={`Piutang berjalan ${rupiah(outstanding)}. Tagihan dibuat dari halaman berkas.`} />
      <Select value={status} onChange={(e) => setStatus(e.target.value)} className="mb-4 max-w-[200px]" aria-label="Filter status">
        <option value="">Semua tagihan</option>
        {Object.entries(STATUS).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </Select>
      {isLoading ? (
        <Loading />
      ) : !data?.length ? (
        <Empty title="Belum ada tagihan" />
      ) : (
        <Table head={['Nomor', 'Berkas', 'Total', 'Dibayar', 'Status', '']}>
          {data.map((i) => {
            const total = Number(i.amount) + Number(i.taxEscrow);
            return (
              <tr key={i.id}>
                <td className={`${td} tabular-nums`}>
                  {i.number}
                  <span className="block text-xs text-ink-faint">{tanggal(i.issuedAt)}</span>
                </td>
                <td className={td}>
                  <Link href={`/matters/${i.matterId}?tab=billing`} className="hover:text-stamp">
                    {i.matterTitle}
                  </Link>
                  <span className="block text-xs text-ink-faint">{i.description}</span>
                </td>
                <td className={`${td} tabular-nums`}>
                  {rupiah(total)}
                  {Number(i.taxEscrow) > 0 && <span className="block text-xs text-ink-faint">termasuk titipan pajak {rupiah(i.taxEscrow)}</span>}
                </td>
                <td className={`${td} tabular-nums`}>{rupiah(i.paid)}</td>
                <td className={td}>
                  <Pill tone={i.status === 'paid' ? 'ok' : i.status === 'partial' ? 'warn' : 'neutral'}>{STATUS[i.status]}</Pill>
                </td>
                <td className={`${td} text-right`}>
                  {can('finance.write') && (i.status === 'unpaid' || i.status === 'partial') && (
                    <Button variant="secondary" onClick={() => setPaying(i)}>
                      Catat pembayaran
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
      )}
      <PaymentModal invoice={paying} onClose={() => setPaying(null)} onDone={() => qc.invalidateQueries({ queryKey: ['invoices'] })} />
    </>
  );
}

function PaymentModal({ invoice, onClose, onDone }: { invoice: Invoice | null; onClose: () => void; onDone: () => void }) {
  const remaining = invoice ? Number(invoice.amount) + Number(invoice.taxEscrow) - Number(invoice.paid) : 0;
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('transfer');
  const [reference, setReference] = useState('');
  const pay = useMutation({
    mutationFn: () => api(`/invoices/${invoice!.id}/payments`, { body: { amount: amount || remaining, method, reference } }),
    onSuccess: () => {
      setAmount('');
      setReference('');
      onClose();
      onDone();
    },
  });
  return (
    <Modal open={!!invoice} onClose={onClose} title={`Catat pembayaran ${invoice?.number ?? ''}`}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          pay.mutate();
        }}
      >
        <Field label="Jumlah (Rp)" hint={`Sisa tagihan ${rupiah(remaining)}`}>
          <Input inputMode="numeric" placeholder={String(remaining)} value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} />
        </Field>
        <Field label="Metode">
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="transfer">Transfer bank</option>
            <option value="va">Virtual account</option>
            <option value="qris">QRIS</option>
            <option value="tunai">Tunai</option>
          </Select>
        </Field>
        <Field label="Referensi" hint="Nomor bukti transfer, opsional">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <ErrorBox>{pay.error && errorText(pay.error)}</ErrorBox>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="quiet" onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" disabled={pay.isPending}>
            Catat pembayaran
          </Button>
        </div>
      </form>
    </Modal>
  );
}

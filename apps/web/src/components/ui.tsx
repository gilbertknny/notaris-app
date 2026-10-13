'use client';

import { forwardRef, useEffect, useRef } from 'react';
import { MATTER_STATUS_LABEL, MatterStatus } from '@notaris/shared';

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'quiet' | 'danger' };

const BUTTON: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'bg-stamp text-white hover:bg-[#4b3286]',
  secondary: 'border border-rule bg-sheet text-ink hover:border-ink-faint',
  quiet: 'text-ink-soft hover:text-ink hover:bg-rule/50',
  danger: 'border border-bad/30 bg-sheet text-bad hover:bg-bad-soft',
};

export function Button({ variant = 'primary', className = '', ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={`inline-flex h-9 items-center justify-center gap-2 rounded-md px-3.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${BUTTON[variant]} ${className}`}
    />
  );
}

const control =
  'block w-full rounded-md border border-rule bg-sheet px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-stamp focus:outline-none focus:ring-2 focus:ring-stamp/20 disabled:bg-paper';

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className = '', ...p }, ref) {
  return <input ref={ref} {...p} className={`${control} h-9 ${className}`} />;
});

export function Select({ className = '', ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={`${control} h-9 ${className}`} />;
}

export function Textarea({ className = '', ...p }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...p} className={`${control} ${className}`} />;
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-sm text-bad">{error}</span> : hint ? <span className="mt-1 block text-xs text-ink-faint">{hint}</span> : null}
    </label>
  );
}

export function ErrorBox({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return <p role="alert" className="rounded-md border border-bad/25 bg-bad-soft px-3 py-2 text-sm text-bad">{children}</p>;
}

export function Notice({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md border border-stamp/20 bg-stamp-soft px-3 py-2 text-sm text-ink">{children}</p>;
}

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-rule pb-5">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-ink-soft">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-rule px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-sm text-ink-soft">{children}</div>}
    </div>
  );
}

export function Loading() {
  return <p className="py-10 text-center text-sm text-ink-faint">Memuat…</p>;
}

/** Tabel data padat; baris bisa diklik bila diberi onClick di <tr>. */
export function Table({ head, children }: { head: React.ReactNode[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-rule bg-sheet">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-rule text-ink-soft">
          <tr>
            {head.map((h, i) => (
              <th key={i} scope="col" className="whitespace-nowrap px-4 py-2.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-rule">{children}</tbody>
      </table>
    </div>
  );
}
export const td = 'px-4 py-3 align-top';

const STATUS_TONE: Record<MatterStatus, string> = {
  intake: 'bg-paper text-ink-soft border-rule',
  documents: 'bg-warn-soft text-warn border-warn/20',
  drafting: 'bg-paper text-ink border-rule',
  review: 'bg-stamp-soft text-stamp border-stamp/25',
  scheduled: 'bg-stamp-soft text-stamp border-stamp/25',
  signed: 'bg-ok-soft text-ok border-ok/25',
  filing: 'bg-ok-soft text-ok border-ok/25',
  done: 'bg-ok-soft text-ok border-ok/25',
  cancelled: 'bg-bad-soft text-bad border-bad/20',
};

export function StatusBadge({ status }: { status: MatterStatus }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded border px-2 py-0.5 text-xs font-medium ${STATUS_TONE[status]}`}>
      {MATTER_STATUS_LABEL[status]}
    </span>
  );
}

export function Pill({ tone = 'neutral', children }: { tone?: 'neutral' | 'ok' | 'warn' | 'bad' | 'stamp'; children: React.ReactNode }) {
  const t = {
    neutral: 'bg-paper text-ink-soft border-rule',
    ok: 'bg-ok-soft text-ok border-ok/25',
    warn: 'bg-warn-soft text-warn border-warn/20',
    bad: 'bg-bad-soft text-bad border-bad/20',
    stamp: 'bg-stamp-soft text-stamp border-stamp/25',
  }[tone];
  return <span className={`inline-flex items-center whitespace-nowrap rounded border px-2 py-0.5 text-xs font-medium ${t}`}>{children}</span>;
}

const RAIL: MatterStatus[] = ['intake', 'documents', 'drafting', 'review', 'scheduled', 'signed', 'filing', 'done'];

/**
 * Jalur berkas: delapan tahap; tahap aktif dicap seperti stempel notaris.
 * Satu-satunya elemen dekoratif yang menonjol di aplikasi.
 */
export function StatusRail({ status, compact = false }: { status: MatterStatus; compact?: boolean }) {
  if (compact && status !== 'cancelled') {
    // Versi ponsel: satu baris, tahap aktif tetap dicap.
    const i = RAIL.indexOf(status);
    return (
      <div>
        <div className="flex items-center justify-between gap-3">
          <span className="stamp inline-block rounded-sm border-2 border-stamp px-1.5 py-0.5 text-[13px] font-semibold text-stamp">{MATTER_STATUS_LABEL[status]}</span>
          <span className="text-xs text-ink-soft">
            Tahap {i + 1} dari {RAIL.length}
          </span>
        </div>
        <div className="mt-3 flex gap-1" aria-hidden>
          {RAIL.map((s, j) => (
            <span key={s} className={`h-1.5 flex-1 rounded-full ${j < i ? 'bg-ink' : j === i ? 'bg-stamp' : 'bg-rule'}`} />
          ))}
        </div>
      </div>
    );
  }
  if (status === 'cancelled') {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-bad/20 bg-bad-soft px-4 py-3 text-sm text-bad">
        <span className="stamp inline-block rounded border-2 border-bad px-2 py-0.5 font-semibold">Dibatalkan</span>
        Berkas ini dibatalkan dan tidak bisa dilanjutkan.
      </div>
    );
  }
  const current = RAIL.indexOf(status);
  return (
    <ol className="grid grid-cols-4 gap-y-4 sm:grid-cols-8" aria-label="Tahap berkas">
      {RAIL.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={s} className="relative flex flex-col items-start pr-2" aria-current={active ? 'step' : undefined}>
            <div className="flex w-full items-center">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${done ? 'bg-ink' : active ? 'bg-stamp' : 'border border-ink-faint bg-sheet'}`} />
              {i < RAIL.length - 1 && <span className={`ml-1 h-px flex-1 ${done ? 'bg-ink' : 'bg-rule'}`} />}
            </div>
            {active ? (
              <span className="stamp mt-2 inline-block rounded-sm border-2 border-stamp px-1.5 py-0.5 text-[13px] font-semibold text-stamp">
                {MATTER_STATUS_LABEL[s]}
              </span>
            ) : (
              <span className={`mt-2 text-[13px] ${done ? 'text-ink' : 'text-ink-faint'}`}>{MATTER_STATUS_LABEL[s]}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) ref.current?.showModal();
    else ref.current?.close();
  }, [open]);
  return (
    <dialog ref={ref} onCancel={onClose} onClose={onClose} className="m-auto w-full max-w-lg rounded-lg border border-rule bg-sheet p-6 text-ink backdrop:bg-ink/40">
      <h2 className="mb-4 text-lg font-semibold">{title}</h2>
      {open && children}
    </dialog>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: string; count?: number }[] }) {
  return (
    <div role="tablist" className="mb-5 flex gap-1 overflow-x-auto border-b border-rule">
      {items.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm ${value === t.id ? 'border-stamp font-medium text-ink' : 'border-transparent text-ink-soft hover:text-ink'}`}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 text-ink-faint">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

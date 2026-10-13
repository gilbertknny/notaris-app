import { MONTHS_ID } from '@notaris/shared';

export interface TemplateContext {
  office: { name: string; notaryName: string; regionCode: string };
  matter: { code: string; title: string };
  parties: { fullName: string; role: string; nik: string | null; address: string | null }[];
  date: Date;
}

const NUMBER_WORDS = ['nol', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];

/** Angka ke kata (Bahasa Indonesia), untuk penulisan tanggal di akta: 13 → "tiga belas". */
export function terbilang(n: number): string {
  if (n < 12) return NUMBER_WORDS[n];
  if (n < 20) return `${terbilang(n - 10)} belas`;
  if (n < 100) return `${terbilang(Math.floor(n / 10))} puluh${n % 10 ? ' ' + terbilang(n % 10) : ''}`;
  if (n < 200) return `seratus${n > 100 ? ' ' + terbilang(n - 100) : ''}`;
  if (n < 1000) return `${terbilang(Math.floor(n / 100))} ratus${n % 100 ? ' ' + terbilang(n % 100) : ''}`;
  if (n < 2000) return `seribu${n > 1000 ? ' ' + terbilang(n - 1000) : ''}`;
  if (n < 1_000_000) return `${terbilang(Math.floor(n / 1000))} ribu${n % 1000 ? ' ' + terbilang(n % 1000) : ''}`;
  return String(n);
}

/**
 * Isi placeholder {{...}} pada template. Placeholder yang tidak dikenal ditandai
 * dengan [[...]] agar mudah ditemukan saat review, tidak dibiarkan diam-diam kosong.
 */
export function renderTemplate(body: string, ctx: TemplateContext): string {
  const d = ctx.date;
  const values: Record<string, string> = {
    'office.name': ctx.office.name,
    'office.notaryName': ctx.office.notaryName,
    'office.region': ctx.office.regionCode,
    'matter.code': ctx.matter.code,
    'matter.title': ctx.matter.title,
    'date.short': `${d.getDate()} ${MONTHS_ID[d.getMonth()]} ${d.getFullYear()}`,
    'date.long': `${terbilang(d.getDate())} ${MONTHS_ID[d.getMonth()]} ${terbilang(d.getFullYear())} (${d.getDate()}-${d.getMonth() + 1}-${d.getFullYear()})`,
    'parties.list': ctx.parties
      .map((p, i) => `${i + 1}. ${p.fullName}${p.nik ? `, NIK ${p.nik}` : ''}${p.address ? `, bertempat tinggal di ${p.address}` : ''}, dalam hal ini bertindak sebagai ${p.role}.`)
      .join('\n'),
  };
  for (const p of ctx.parties) {
    const key = p.role.toLowerCase().replace(/\s+/g, '_');
    values[`party.${key}.name`] ??= p.fullName;
    values[`party.${key}.nik`] ??= p.nik ?? '[[NIK belum diisi]]';
    values[`party.${key}.address`] ??= p.address ?? '[[alamat belum diisi]]';
  }
  return body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => values[key] ?? `[[${key}]]`);
}

import { renderTemplate, terbilang } from '../src/modules/drafting/render-template';
import { periodOf } from '../src/modules/registry/registry.controller';

describe('renderTemplate', () => {
  const ctx = {
    office: { name: 'Kantor', notaryName: 'Notaris X', regionCode: 'Jakarta Selatan' },
    matter: { code: '2026/10/0001', title: 'Jual beli' },
    parties: [
      { fullName: 'Hendra', role: 'penjual', nik: '3174011203800001', address: 'Jl. A' },
      { fullName: 'Maria', role: 'pembeli', nik: null, address: null },
    ],
    date: new Date(2026, 9, 13),
  };

  it('mengisi placeholder yang dikenal', () => {
    const out = renderTemplate('{{office.notaryName}} | {{party.penjual.name}} | {{party.pembeli.name}} | {{matter.code}}', ctx);
    expect(out).toBe('Notaris X | Hendra | Maria | 2026/10/0001');
  });

  it('menandai placeholder yang tidak dikenal atau data kosong dengan [[...]]', () => {
    expect(renderTemplate('{{harga}}', ctx)).toBe('[[harga]]');
    expect(renderTemplate('{{party.pembeli.nik}}', ctx)).toBe('[[NIK belum diisi]]');
  });

  it('menulis tanggal dengan huruf', () => {
    expect(renderTemplate('{{date.long}}', ctx)).toBe('tiga belas Oktober dua ribu dua puluh enam (13-10-2026)');
  });
});

describe('terbilang', () => {
  it.each([
    [1, 'satu'],
    [11, 'sebelas'],
    [19, 'sembilan belas'],
    [21, 'dua puluh satu'],
    [100, 'seratus'],
    [2026, 'dua ribu dua puluh enam'],
  ])('%i → %s', (n, s) => expect(terbilang(n)).toBe(s));
});

describe('periodOf', () => {
  it('memakai zona waktu kantor: 31 Okt 20:00 UTC = 1 Nov WIB', () => {
    expect(periodOf(new Date('2026-10-31T20:00:00Z'), 'Asia/Jakarta')).toBe('2026-11-01');
    expect(periodOf(new Date('2026-10-31T20:00:00Z'), 'UTC')).toBe('2026-10-01');
  });
});

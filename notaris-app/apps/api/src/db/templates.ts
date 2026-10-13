/**
 * Template contoh untuk demo. BUKAN template hukum siap pakai:
 * isi, susunan, dan klausul wajib divalidasi Notaris sebelum dipakai.
 * Placeholder: {{office.notaryName}}, {{office.region}}, {{matter.code}}, {{matter.title}},
 * {{date.long}}, {{date.short}}, {{parties.list}}, {{party.<peran>.name|nik|address}}.
 */
export const SEED_TEMPLATES = [
  {
    code: 'ajb',
    name: 'Akta Jual Beli (contoh)',
    service_type: 'ajb',
    body: `AKTA JUAL BELI
Nomor: [diisi saat penandatanganan]

Pada hari ini, tanggal {{date.long}}, hadir di hadapan saya, {{office.notaryName}}, Pejabat Pembuat Akta Tanah di {{office.region}}, dengan dihadiri saksi-saksi yang saya kenal dan akan disebut pada bagian akhir akta ini:

{{parties.list}}

Pihak Pertama ({{party.penjual.name}}) menerangkan dengan akta ini menjual kepada Pihak Kedua ({{party.pembeli.name}}), dan Pihak Kedua menerangkan membeli dari Pihak Pertama:

Hak atas tanah: [[jenis dan nomor hak]]
Nomor Identifikasi Bidang (NIB): [[NIB]]
Letak: [[alamat objek]]
Luas: [[luas]] m²

Jual beli ini dilakukan dengan harga Rp [[harga]] ([[harga terbilang]]).

Pasal 1 — Objek jual beli diserahkan dalam keadaan bebas dari sengketa, sitaan, dan beban apa pun.
Pasal 2 — Biaya dan pajak yang timbul ditanggung sesuai ketentuan yang berlaku.

Demikian akta ini dibuat di {{office.region}}. Berkas: {{matter.code}}.`,
  },
  {
    code: 'pendirian_pt',
    name: 'Pendirian PT (contoh)',
    service_type: 'pendirian_pt',
    body: `AKTA PENDIRIAN PERSEROAN TERBATAS
{{matter.title}}

Pada hari ini, tanggal {{date.long}}, menghadap kepada saya, {{office.notaryName}}, Notaris di {{office.region}}, dengan dihadiri saksi-saksi:

{{parties.list}}

Para penghadap menerangkan bahwa dengan akta ini mereka mendirikan suatu perseroan terbatas dengan anggaran dasar sebagai berikut:

NAMA DAN TEMPAT KEDUDUKAN
Pasal 1 — Perseroan ini bernama [[nama perseroan]] dan berkedudukan di [[kota]].

MAKSUD DAN TUJUAN SERTA KEGIATAN USAHA
Pasal 2 — [[KBLI dan uraian kegiatan usaha]]

MODAL
Pasal 3 — Modal dasar Perseroan sebesar Rp [[modal dasar]], modal ditempatkan dan disetor Rp [[modal disetor]].

Berkas: {{matter.code}}.`,
  },
  {
    code: 'kuasa',
    name: 'Kuasa (contoh)',
    service_type: 'kuasa',
    body: `KUASA

Pada hari ini, tanggal {{date.long}}, menghadap kepada saya, {{office.notaryName}}, Notaris di {{office.region}}:

{{parties.list}}

Pemberi kuasa ({{party.pemberi_kuasa.name}}) dengan ini memberi kuasa kepada penerima kuasa ({{party.penerima_kuasa.name}}) untuk dan atas nama pemberi kuasa melakukan: [[uraian kuasa]].

Kuasa ini diberikan dengan hak substitusi [[ya/tidak]]. Berkas: {{matter.code}}.`,
  },
];

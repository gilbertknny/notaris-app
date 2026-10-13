import { Injectable } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { config } from '../../config';

/**
 * Penyimpanan dokumen di disk lokal (pengembangan / server tunggal).
 * Untuk produksi, ganti implementasi ini dengan object storage terenkripsi (S3-compatible)
 * dan URL bertanda tangan langsung dari storage — antarmukanya sengaja dibuat kecil.
 */
@Injectable()
export class StorageService {
  private readonly root = resolve(config().STORAGE_DIR);

  private path(key: string) {
    const p = resolve(this.root, key);
    if (!p.startsWith(this.root + '/')) throw new Error('Kunci storage tidak valid');
    return p;
  }

  async put(key: string, data: Buffer) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data, { mode: 0o600 });
  }

  read(key: string) {
    return readFile(this.path(key));
  }

  stream(key: string) {
    return createReadStream(this.path(key));
  }

  /** Pindahkan file yang gagal pemindaian ke area karantina. */
  async quarantine(key: string) {
    const target = this.path(`quarantine/${key}`);
    await mkdir(dirname(target), { recursive: true });
    await rename(this.path(key), target);
    return `quarantine/${key}`;
  }
}

/** Cek tanda tangan file (magic bytes); jangan percaya ekstensi atau Content-Type dari browser. */
export function sniffMime(buf: Buffer): string | null {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  return null;
}

export const ALLOWED_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png']);

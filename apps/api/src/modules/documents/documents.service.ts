import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DOCUMENT_KINDS, uploadDocumentSchema } from '@notaris/shared';
import type { AuthContext } from '../../common/auth/auth-context';
import { CryptoService } from '../../common/crypto.service';
import { emit, Trx, writeAudit } from '../../common/db.service';
import { AppError } from '../../common/errors';
import { parse } from '../../common/validate';
import { ALLOWED_MIME, StorageService } from './storage.service';

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly storage: StorageService,
    private readonly crypto: CryptoService,
  ) {}

  /** Simpan unggahan (staf atau klien). File berstatus pending_scan sampai worker memindainya. */
  async saveUpload(trx: Trx, auth: AuthContext, matterId: string, file: UploadedFile | undefined, body: unknown) {
    if (!file) throw new AppError('NO_FILE', 'File wajib diunggah');
    const { kind, clientId } = parse(uploadDocumentSchema, body);
    if (!ALLOWED_MIME.has(file.mimetype)) throw new AppError('FILE_TYPE', 'Hanya PDF, JPG, atau PNG yang diizinkan', 415);

    if (clientId) {
      const party = await trx
        .selectFrom('matter_parties')
        .select('client_id')
        .where('matter_id', '=', matterId)
        .where('client_id', '=', clientId)
        .executeTakeFirst();
      if (!party) throw new AppError('INVALID', 'Klien bukan pihak pada berkas ini');
    }
    const ownerClient = auth.kind === 'client' ? auth.clientId : (clientId ?? null);
    const previous = await trx
      .selectFrom('documents')
      .select(({ fn }) => fn.max('version').as('v'))
      .where('matter_id', '=', matterId)
      .where('kind', '=', kind)
      .executeTakeFirst();

    const id = randomUUID();
    const storageKey = `${auth.officeId}/${matterId}/${id}`;
    await this.storage.put(storageKey, file.buffer);
    const doc = await trx
      .insertInto('documents')
      .values({
        id,
        office_id: auth.officeId,
        matter_id: matterId,
        client_id: ownerClient,
        kind,
        filename: file.originalname.replace(/[^\w.\- ]+/g, '_').slice(0, 150),
        mime: file.mimetype,
        size_bytes: file.size,
        storage_key: storageKey,
        sha256: this.crypto.sha256(file.buffer),
        version: (Number(previous?.v) || 0) + 1,
        uploaded_by_user: auth.kind === 'staff' ? auth.userId : null,
        uploaded_by_client: auth.kind === 'client' ? auth.clientId : null,
      })
      .returning(['id', 'kind', 'filename', 'status', 'version'])
      .executeTakeFirstOrThrow();
    await writeAudit(trx, auth, {
      action: 'document.uploaded',
      entity: 'matter',
      entityId: matterId,
      detail: { documentId: id, kind: DOCUMENT_KINDS[kind as keyof typeof DOCUMENT_KINDS] ?? kind },
    });
    await emit(trx, auth.officeId, 'document.uploaded', { documentId: id, matterId });
    return doc;
  }
}

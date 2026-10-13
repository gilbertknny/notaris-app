import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';

/** Error domain dengan kode stabil yang bisa ditangani frontend. */
export class AppError extends Error {
  /** Entri audit yang tetap ditulis walau transaksi pemicunya di-rollback (mis. akses ditolak). */
  audit?: { action: string; entity: string; entityId?: string | null; detail?: Record<string, unknown> };

  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = HttpStatus.BAD_REQUEST,
    public readonly details?: unknown,
  ) {
    super(message);
  }

  withAudit(entry: NonNullable<AppError['audit']>): this {
    this.audit = entry;
    return this;
  }
}

export const NotFound = (what = 'Data') => new AppError('NOT_FOUND', `${what} tidak ditemukan`, 404);
export const Forbidden = (code = 'FORBIDDEN', message = 'Anda tidak memiliki akses') => new AppError(code, message, 403);

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Error');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { traceId?: string }>();
    const traceId = req.traceId;

    let status = 500;
    let body: Record<string, unknown> = { code: 'INTERNAL', message: 'Terjadi kesalahan pada server' };

    if (exception instanceof AppError) {
      status = exception.status;
      body = { code: exception.code, message: exception.message, details: exception.details };
    } else if (exception instanceof ZodError) {
      status = 400;
      body = {
        code: 'VALIDATION',
        message: 'Data tidak valid',
        details: exception.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r = exception.getResponse();
      body = {
        code: status === 404 ? 'NOT_FOUND' : status === 413 ? 'FILE_TOO_LARGE' : 'HTTP_ERROR',
        message: typeof r === 'string' ? r : ((r as { message?: string }).message ?? exception.message),
      };
    } else if (isPgError(exception) && exception.code === '23505') {
      status = 409;
      body = { code: 'CONFLICT', message: 'Data sudah ada (duplikat)' };
    } else {
      // Detail teknis hanya di log, tidak di respons.
      this.logger.error({ traceId, err: (exception as Error)?.message, stack: (exception as Error)?.stack });
    }
    res.status(status).json({ ...body, traceId });
  }
}

function isPgError(e: unknown): e is { code: string } {
  return typeof e === 'object' && e !== null && 'code' in e && typeof (e as { code: unknown }).code === 'string';
}

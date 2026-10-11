import { Inject, Injectable } from '@nestjs/common';
import {
  can,
  FILE_LIMITS,
  type FileKind,
  type FileUrlResponse,
  type Permission,
  type PresignInput,
  type PresignResponse,
} from '@boogbe/shared';
import { OrgDb, type OrgTx } from '../db/org-db.service';
import { newId } from '../db/ids';
import { AppError, forbidden, notFound } from '../http/app-error';
import type { OrgCtx } from '../auth/request-ctx';
import { STORAGE, type Storage } from './storage';

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};
const UPLOAD_PERMS: Record<FileKind, Permission[]> = {
  logo: ['org.settings.write'],
  receipt_image: ['expenses.write', 'payments.write'],
  task_photo: ['tasks.write_own', 'tasks.write'],
  statement_pdf: [],
  receipt_pdf: [],
};
// notifications.read is held by every role, so any member may see the operator logo.
const READ_PERMS: Record<FileKind, Permission[]> = {
  logo: ['notifications.read'],
  receipt_image: ['expenses.read', 'payments.read'],
  task_photo: ['tasks.read_own', 'tasks.read'],
  statement_pdf: ['statements.read', 'portal.read'],
  receipt_pdf: ['payments.read'],
};

@Injectable()
export class FilesService {
  constructor(
    private readonly orgDb: OrgDb,
    @Inject(STORAGE) private readonly storage: Storage,
  ) {}

  private assert(ctx: OrgCtx, perms: Permission[]) {
    if (!perms.some((p) => can(ctx.role, p))) throw forbidden();
  }

  async presign(ctx: OrgCtx, input: PresignInput): Promise<PresignResponse> {
    this.assert(ctx, UPLOAD_PERMS[input.kind]);
    const id = newId();
    const key = `org/${ctx.orgId}/${input.kind}/${id}.${EXT[input.contentType]}`;
    await this.orgDb.run(ctx.orgId, (tx) =>
      tx.file.create({
        data: {
          id,
          key,
          kind: input.kind,
          contentType: input.contentType,
          sizeBytes: input.sizeBytes,
          uploadedByMemberId: ctx.memberId,
        } as never,
      }),
    );
    const { url, headers } = await this.storage.presignPut(key, input.contentType, input.sizeBytes);
    return { fileId: id, uploadUrl: url, headers };
  }

  async confirm(ctx: OrgCtx, fileId: string): Promise<void> {
    await this.orgDb.run(ctx.orgId, async (tx) => {
      const f = await tx.file.findFirst({ where: { id: fileId } });
      if (!f) throw notFound('File');
      this.assert(ctx, UPLOAD_PERMS[f.kind as FileKind]);
      const head = await this.storage.head(f.key);
      if (!head) throw new AppError('VALIDATION_FAILED', 400, 'Upload not found — try again');
      if (head.size > FILE_LIMITS[f.kind as FileKind].maxBytes)
        throw new AppError('VALIDATION_FAILED', 400, 'File is too large');
      await tx.file.updateMany({ where: { id: fileId }, data: { confirmed: true, sizeBytes: head.size } });
    });
  }

  async urlFor(ctx: OrgCtx, fileId: string, filename?: string): Promise<FileUrlResponse> {
    const f = await this.orgDb.run(ctx.orgId, (tx) =>
      tx.file.findFirst({ where: { id: fileId, confirmed: true } }),
    );
    if (!f) throw notFound('File');
    this.assert(ctx, READ_PERMS[f.kind as FileKind]);
    return {
      url: await this.storage.presignGet(f.key, filename),
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    };
  }

  /** For server-side code that already authorised the caller (e.g. settings logo, owner statements). */
  async signedUrlForKey(key: string, filename?: string) {
    return this.storage.presignGet(key, filename);
  }

  async assertConfirmed(tx: OrgTx, fileId: string, kind: FileKind) {
    const f = await tx.file.findFirst({ where: { id: fileId, kind, confirmed: true } });
    if (!f) throw new AppError('VALIDATION_FAILED', 400, 'File not uploaded');
    return f;
  }

  async storeGenerated(
    orgId: string,
    kind: 'statement_pdf' | 'receipt_pdf',
    body: Buffer,
    actorMemberId: string | null,
  ) {
    const id = newId();
    const key = `org/${orgId}/${kind}/${id}.pdf`;
    await this.storage.put(key, body, 'application/pdf');
    await this.orgDb.run(orgId, (tx) =>
      tx.file.create({
        data: {
          id,
          key,
          kind,
          contentType: 'application/pdf',
          sizeBytes: body.length,
          uploadedByMemberId: actorMemberId,
          confirmed: true,
        } as never,
      }),
    );
    return { fileId: id, key };
  }
}

import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const STORAGE = 'BOOGBE_STORAGE';
/** Public media bucket (WL variants). Its own token so a module can't accidentally write the private one. */
export const MEDIA_STORAGE = 'BOOGBE_MEDIA_STORAGE';

export interface Storage {
  presignPut(
    key: string,
    contentType: string,
    sizeBytes: number,
  ): Promise<{ url: string; headers: Record<string, string> }>;
  presignGet(key: string, filename?: string): Promise<string>;
  head(key: string): Promise<{ size: number } | null>;
  put(key: string, body: Buffer, contentType: string, opts?: { cacheControl?: string }): Promise<void>;
  get(key: string): Promise<Buffer | null>;
}

const TTL = 300;

export class R2Storage implements Storage {
  private readonly s3: S3Client;
  constructor(
    endpoint: string,
    private readonly bucket: string,
    accessKeyId: string,
    secretAccessKey: string,
  ) {
    this.s3 = new S3Client({ region: 'auto', endpoint, credentials: { accessKeyId, secretAccessKey } });
  }

  async presignPut(key: string, contentType: string, sizeBytes: number) {
    // ContentLength is signed, so the client cannot upload more than it declared.
    const url = await getSignedUrl(
      this.s3,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: sizeBytes,
      }),
      { expiresIn: TTL },
    );
    return { url, headers: { 'content-type': contentType } };
  }

  presignGet(key: string, filename?: string) {
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(filename && { ResponseContentDisposition: `attachment; filename="${filename}"` }),
      }),
      { expiresIn: TTL },
    );
  }

  async head(key: string) {
    try {
      const r = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: r.ContentLength ?? 0 };
    } catch (e) {
      if ((e as { name?: string }).name === 'NotFound') return null;
      throw e;
    }
  }

  async put(key: string, body: Buffer, contentType: string, opts?: { cacheControl?: string }) {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ...(opts?.cacheControl && { CacheControl: opts.cacheControl }),
      }),
    );
  }

  async get(key: string) {
    try {
      const r = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return r.Body ? Buffer.from(await r.Body.transformToByteArray()) : null;
    } catch (e) {
      if ((e as { name?: string }).name === 'NoSuchKey') return null;
      throw e;
    }
  }
}

/** Dev/test storage: objects in memory, URLs `memory://<key>` (uploads) and `memory://get/<key>` (downloads). */
export class MemoryStorage implements Storage {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();
  async presignPut(key: string, contentType: string) {
    return { url: `memory://${key}`, headers: { 'content-type': contentType } };
  }
  async presignGet(key: string) {
    return `memory://get/${key}`;
  }
  async head(key: string) {
    const o = this.objects.get(key);
    return o ? { size: o.body.length } : null;
  }
  async put(key: string, body: Buffer, contentType: string) {
    this.objects.set(key, { body, contentType });
  }
  async get(key: string) {
    return this.objects.get(key)?.body ?? null;
  }
}

/** Keys a namespace into another storage — dev/test keeps the media bucket separate from originals
 *  in one in-memory store, under `media/` (plan: "reuse the existing dev or test storage under a media/ prefix"). */
export class PrefixedStorage implements Storage {
  constructor(
    private readonly inner: Storage,
    private readonly prefix: string,
  ) {}
  private k(key: string) {
    return `${this.prefix}${key}`;
  }
  presignPut(key: string, contentType: string, sizeBytes: number) {
    return this.inner.presignPut(this.k(key), contentType, sizeBytes);
  }
  presignGet(key: string, filename?: string) {
    return this.inner.presignGet(this.k(key), filename);
  }
  head(key: string) {
    return this.inner.head(this.k(key));
  }
  put(key: string, body: Buffer, contentType: string, opts?: { cacheControl?: string }) {
    return this.inner.put(this.k(key), body, contentType, opts);
  }
  get(key: string) {
    return this.inner.get(this.k(key));
  }
}

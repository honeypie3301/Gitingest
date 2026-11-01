import { createReadStream } from 'node:fs';
import { S3Client, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export class ArtifactStorage {
  private client?: S3Client;
  private bucket = process.env.INGEST_S3_BUCKET;

  constructor() {
    if (this.bucket) {
      this.client = new S3Client({
        region: process.env.AWS_REGION || 'us-east-1',
        endpoint: process.env.INGEST_S3_ENDPOINT || undefined,
        forcePathStyle: Boolean(process.env.INGEST_S3_ENDPOINT),
      });
    }
  }

  get enabled() { return Boolean(this.client); }

  async upload(key: string, filename: string, signal?: AbortSignal, downloadName = 'repository_digest.txt') {
    if (!this.client) return;
    const upload = new Upload({
      client: this.client,
      params: { Bucket: this.bucket!, Key: key, Body: createReadStream(filename), ContentType: 'text/plain; charset=utf-8', ContentDisposition: `attachment; filename="${downloadName}"` },
      queueSize: 2,
      partSize: 8 * 1024 * 1024,
    });
    const abort = () => { void upload.abort(); };
    signal?.addEventListener('abort', abort, { once: true });
    try { signal?.throwIfAborted(); await upload.done(); }
    finally { signal?.removeEventListener('abort', abort); }
  }

  async url(key: string): Promise<string | undefined> {
    if (!this.client) return undefined;
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket!, Key: key }), { abortSignal: AbortSignal.timeout(10_000) });
    } catch (error: any) {
      if (error.$metadata?.httpStatusCode === 404 || error.name === 'NotFound') return undefined;
      throw error;
    }
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket!, Key: key }), { expiresIn: 900 });
  }
}

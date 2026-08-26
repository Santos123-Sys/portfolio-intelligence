import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

export interface StorageConfiguration {
  AGENTIC_BUCKET_NAME?: string;
  AGENTIC_BUCKET_ENDPOINT?: string;
  AGENTIC_BUCKET_REGION: string;
  AGENTIC_BUCKET_ACCESS_KEY_ID?: string;
  AGENTIC_BUCKET_SECRET_ACCESS_KEY?: string;
}

export interface StoredReport {
  objectKey: string | null;
  bytes: Buffer | null;
}

export class ReportStorage {
  private readonly client: S3Client | null;
  private readonly bucket: string | null;

  constructor(config: StorageConfiguration) {
    this.bucket = config.AGENTIC_BUCKET_NAME ?? null;
    this.client = this.bucket
      ? new S3Client({
          endpoint: config.AGENTIC_BUCKET_ENDPOINT,
          region: config.AGENTIC_BUCKET_REGION,
          forcePathStyle: true,
          credentials: {
            accessKeyId: config.AGENTIC_BUCKET_ACCESS_KEY_ID!,
            secretAccessKey: config.AGENTIC_BUCKET_SECRET_ACCESS_KEY!,
          },
        })
      : null;
  }

  async put(externalRunId: string, pdf: Buffer): Promise<StoredReport> {
    if (!this.client || !this.bucket) return { objectKey: null, bytes: pdf };
    const objectKey = `reports/${externalRunId}.pdf`;
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      Body: pdf,
      ContentType: 'application/pdf',
      CacheControl: 'private, max-age=3600',
      Metadata: { externalRunId },
    }));
    return { objectKey, bytes: null };
  }

  async get(objectKey: string): Promise<Buffer> {
    if (!this.client || !this.bucket) throw new Error('Report bucket is not configured');
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }));
    if (!response.Body) throw new Error('Report object has no body');
    return Buffer.from(await response.Body.transformToByteArray());
  }
}

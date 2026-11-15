import { createHash, createHmac } from 'crypto';

export function presignPut(input: {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  key: string;
  expiresSeconds?: number;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const endpoint = input.endpoint?.replace(/\/$/, '');
  const host = endpoint ? new URL(endpoint).host : `${input.bucket}.s3.${input.region}.amazonaws.com`;
  const encodedKey = input.key.split('/').map(encodeURIComponent).join('/');
  const canonicalUri = endpoint ? `/${input.bucket}/${encodedKey}` : `/${encodedKey}`;
  const credential = `${input.accessKey}/${dateStamp}/${input.region}/s3/aws4_request`;
  const params = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', credential],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(input.expiresSeconds ?? 900)],
    ['X-Amz-SignedHeaders', 'host'],
  ].sort(([left], [right]) => left.localeCompare(right));
  const canonicalQuery = params.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');
  const canonical = ['PUT', canonicalUri, canonicalQuery, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const scope = `${dateStamp}/${input.region}/s3/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${createHash('sha256').update(canonical).digest('hex')}`;
  const signingKey = ['aws4_request', 's3', input.region, dateStamp].reduceRight(
    (key, part) => createHmac('sha256', key).update(part).digest(),
    Buffer.from(`AWS4${input.secretKey}`),
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  const base = endpoint ? `${endpoint}${canonicalUri}` : `https://${host}${canonicalUri}`;
  return `${base}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

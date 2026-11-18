import { presignPut } from './uploads';

describe('presignPut', () => {
  it('builds a signed upload URL for the object key', () => {
    const url = presignPut({
      region: 'auto',
      bucket: 'promec-media',
      accessKey: 'AKIA',
      secretKey: 'secret',
      key: 'products/photo.jpg',
      now: new Date('2026-11-14T08:00:00.000Z'),
    });
    expect(url).toContain('products/photo.jpg');
    expect(url).toContain('X-Amz-Signature=');
    expect(url).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256');
  });
});

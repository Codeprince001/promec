import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { decryptField, encryptField, encryptionKey } from './field-cipher';

@Injectable()
export class FieldCipher {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    this.key = encryptionKey(config.getOrThrow<string>('FIELD_ENCRYPTION_KEY'));
  }

  encrypt(plaintext: string) {
    return encryptField(plaintext, this.key);
  }

  decrypt(payload: string) {
    return decryptField(payload, this.key);
  }
}

import { Global, Module } from '@nestjs/common';
import { FieldCipher } from './field-cipher.service';

@Global()
@Module({
  providers: [FieldCipher],
  exports: [FieldCipher],
})
export class CryptoModule {}

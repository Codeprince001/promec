import { Module } from '@nestjs/common';
import { CompatibilityModule } from '../compatibility/compatibility.module';
import { SearchController } from './search.controller';
import { ProductIndex } from './product-index';
import { SearchService } from './search.service';

@Module({
  imports: [CompatibilityModule],
  controllers: [SearchController],
  providers: [SearchService, ProductIndex],
  exports: [SearchService],
})
export class SearchModule {}

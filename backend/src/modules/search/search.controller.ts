import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Public } from '../../common/decorators/public.decorator';
import { SearchService } from './search.service';

const searchQuery = z.object({
  q: z.string().min(1).optional(),
  vehicleVariantId: z.string().uuid().optional(),
  year: z.coerce.number().int().optional(),
  category: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['relevance', 'price_asc', 'price_desc', 'newest']).optional(),
});

@ApiTags('search')
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Public()
  @Get()
  query(@Query({ schema: searchQuery }) query: z.infer<typeof searchQuery>) {
    return this.search.search(query);
  }

  @Public()
  @Get('suggest')
  suggest(@Query({ schema: z.object({ q: z.string().min(1) }) }) query: { q: string }) {
    return this.search.suggest(query.q);
  }
}

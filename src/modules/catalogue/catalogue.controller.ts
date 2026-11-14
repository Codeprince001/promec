import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { CatalogueService, productWriteSchema } from './catalogue.service';

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  category: z.string().optional(),
  q: z.string().optional(),
});

@ApiTags('catalogue')
@Controller()
export class CatalogueController {
  constructor(private readonly catalogue: CatalogueService) {}

  @Public()
  @Get('categories')
  categories() {
    return this.catalogue.categories();
  }

  @Public()
  @Get('products')
  products(@Query({ schema: listQuery }) query: z.infer<typeof listQuery>) {
    return this.catalogue.list(query);
  }

  @Public()
  @Get('products/:slug')
  product(@Param('slug') slug: string) {
    return this.catalogue.bySlug(slug);
  }

  @Post('admin/products')
  @Permissions('catalogue.manage')
  create(@CurrentUser() user: AuthUser, @Body({ schema: productWriteSchema }) body: z.infer<typeof productWriteSchema>) {
    return this.catalogue.create(body, user.sub);
  }

  @Patch('admin/products/:id')
  @Permissions('catalogue.manage')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body({ schema: productWriteSchema.partial() }) body: Partial<z.infer<typeof productWriteSchema>>,
  ) {
    return this.catalogue.update(id, body, user.sub);
  }
}

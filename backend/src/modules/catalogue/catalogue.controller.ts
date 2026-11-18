import { Body, Controller, Get, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiException } from '../../common/api.exception';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { CatalogueService, productWriteSchema } from './catalogue.service';
import { presignPut } from './uploads';

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  category: z.string().optional(),
  q: z.string().optional(),
});

@ApiTags('catalogue')
@Controller()
export class CatalogueController {
  constructor(
    private readonly catalogue: CatalogueService,
    private readonly config: ConfigService,
  ) {}

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

  @Get('admin/products')
  @Permissions('catalogue.manage')
  adminProducts(@Query({ schema: listQuery.extend({ status: z.string().optional() }) }) query: z.infer<typeof listQuery> & { status?: string }) {
    return this.catalogue.adminList(query);
  }

  @Get('admin/products/:id')
  @Permissions('catalogue.manage')
  adminProduct(@Param('id') id: string) {
    return this.catalogue.adminOne(id);
  }

  @Get('admin/manufacturers')
  @Permissions('catalogue.manage')
  manufacturers() {
    return this.catalogue.manufacturers();
  }

  @Post('admin/categories')
  @Permissions('catalogue.manage')
  createCategory(
    @Body({ schema: z.object({ name: z.string().min(2).max(80), parentId: z.string().uuid().optional(), description: z.string().max(400).optional(), sortOrder: z.number().int().min(0).max(999).optional() }) })
    body: { name: string; parentId?: string; description?: string; sortOrder?: number },
  ) {
    return this.catalogue.createCategory(body);
  }

  @Patch('admin/categories/:id')
  @Permissions('catalogue.manage')
  updateCategory(
    @Param('id') id: string,
    @Body({ schema: z.object({ name: z.string().min(2).max(80).optional(), description: z.string().max(400).nullable().optional(), sortOrder: z.number().int().min(0).max(999).optional() }) })
    body: { name?: string; description?: string | null; sortOrder?: number },
  ) {
    return this.catalogue.updateCategory(id, body);
  }

  @Patch('admin/manufacturers/:id')
  @Permissions('catalogue.manage')
  updateManufacturer(
    @Param('id') id: string,
    @Body({ schema: z.object({ name: z.string().min(2).max(120).optional(), country: z.string().max(80).nullable().optional(), type: z.enum(['oem', 'aftermarket']).optional() }) })
    body: { name?: string; country?: string | null; type?: string },
  ) {
    return this.catalogue.updateManufacturer(id, body);
  }

  @Post('admin/manufacturers')
  @Permissions('catalogue.manage')
  createManufacturer(
    @Body({ schema: z.object({ name: z.string().min(2).max(120), country: z.string().max(80).optional(), type: z.enum(['oem', 'aftermarket']).default('aftermarket') }) })
    body: { name: string; country?: string; type: string },
  ) {
    return this.catalogue.createManufacturer(body);
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

  @Post('admin/products/:id/media')
  @Permissions('catalogue.manage')
  media(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body({ schema: z.object({ url: z.string().url(), alt: z.string().max(160).optional() }) }) body: { url: string; alt?: string },
  ) {
    return this.catalogue.addMedia(id, body.url, body.alt, user.sub);
  }

  @Post('admin/products/:id/cross-references')
  @Permissions('catalogue.manage')
  crossReference(
    @Param('id') id: string,
    @Body({ schema: z.object({ fromNumber: z.string().min(2), toNumber: z.string().min(2), relation: z.enum(['equivalent', 'superseded', 'related']).default('equivalent') }) }) body: { fromNumber: string; toNumber: string; relation: string },
  ) {
    return this.catalogue.addCrossReference(id, body.fromNumber, body.toNumber, body.relation);
  }

  @Post('admin/products/import')
  @Permissions('catalogue.manage')
  importCsv(@CurrentUser() user: AuthUser, @Body({ schema: z.object({ csv: z.string().min(1).max(500_000) }) }) body: { csv: string }) {
    return this.catalogue.importCsv(body.csv, user.sub);
  }

  @Post('admin/uploads/presign')
  @Permissions('catalogue.manage')
  presign(@Body({ schema: z.object({ filename: z.string().min(1).max(180), contentType: z.string().default('image/jpeg') }) }) body: { filename: string; contentType: string }) {
    const bucket = this.config.get<string>('S3_BUCKET') ?? '';
    const accessKey = this.config.get<string>('S3_ACCESS_KEY') ?? '';
    const secretKey = this.config.get<string>('S3_SECRET_KEY') ?? '';
    if (!bucket || !accessKey || !secretKey) {
      throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, 'UPLOAD_NOT_CONFIGURED', 'Object storage is not configured. Attach an https photo URL instead.');
    }
    const key = `products/${Date.now()}-${body.filename.replace(/[^\w.-]+/g, '-')}`;
    return {
      method: 'PUT',
      contentType: body.contentType,
      key,
      url: presignPut({
        endpoint: this.config.get<string>('S3_ENDPOINT') || undefined,
        region: this.config.get<string>('S3_REGION') || 'auto',
        bucket,
        accessKey,
        secretKey,
        key,
      }),
    };
  }
}

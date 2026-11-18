import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { CompatibilityService } from './compatibility.service';

const checkQuery = z.object({
  productId: z.string().uuid(),
  vehicleVariantId: z.string().uuid(),
  year: z.coerce.number().int().optional(),
});

const bulkSchema = z.object({
  items: z.array(z.object({ productId: z.string().uuid(), vehicleVariantId: z.string().uuid() })).max(100),
});

const writeSchema = z.object({
  productId: z.string().uuid(),
  vehicleVariantId: z.string().uuid().optional(),
  status: z.enum(['confirmed', 'probable', 'unverified', 'incompatible']),
  notes: z.string().max(1000).optional(),
  position: z.string().max(40).optional(),
  sourceName: z.string().max(120).optional(),
});

@ApiTags('compatibility')
@Controller('compatibility')
export class CompatibilityController {
  constructor(private readonly compatibility: CompatibilityService) {}

  @Public()
  @Get('check')
  check(@Query({ schema: checkQuery }) query: z.infer<typeof checkQuery>) {
    return this.compatibility.check(query.productId, query.vehicleVariantId, query.year);
  }

  @Public()
  @Post('check-bulk')
  bulk(@Body({ schema: bulkSchema }) body: z.infer<typeof bulkSchema>) {
    return this.compatibility.checkMany(body.items);
  }

  @Post('admin')
  @Permissions('compatibility.manage')
  create(@CurrentUser() user: AuthUser, @Body({ schema: writeSchema }) body: z.infer<typeof writeSchema>) {
    return this.compatibility.create({ ...body, actorId: user.sub });
  }

  @Get('admin')
  @Permissions('compatibility.manage')
  list(@Query({ schema: z.object({ productId: z.string().uuid().optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) }) }) query: { productId?: string; page: number; pageSize: number }) {
    return this.compatibility.adminList(query);
  }

  @Patch('admin/:id')
  @Permissions('compatibility.manage')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body({ schema: writeSchema.partial() }) body: Partial<z.infer<typeof writeSchema>>,
  ) {
    return this.compatibility.update(id, { ...body, actorId: user.sub });
  }

  @Delete('admin/:id')
  @Permissions('compatibility.manage')
  remove(@Param('id') id: string) {
    return this.compatibility.remove(id);
  }
}

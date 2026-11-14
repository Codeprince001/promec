import { Body, Controller, Get, Module, Param, Patch, Post } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UserType } from '@prisma/client';
import { z } from 'zod';
import { ApiException } from '../../common/api.exception';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PrismaService } from '../../prisma/prisma.service';

const applySchema = z.object({ businessName: z.string().min(2).max(160) });
const reviewSchema = z.object({ status: z.enum(['pending', 'approved', 'suspended', 'rejected']) });

@ApiTags('vendors')
@Controller()
export class VendorsController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('vendors/apply')
  async apply(@CurrentUser() user: AuthUser, @Body({ schema: applySchema }) body: z.infer<typeof applySchema>) {
    const existing = await this.prisma.vendor.findUnique({ where: { userId: user.sub } });
    if (existing) throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'A vendor application already exists');
    await this.prisma.user.update({ where: { id: user.sub }, data: { userType: UserType.vendor } });
    return this.prisma.vendor.create({ data: { userId: user.sub, businessName: body.businessName } });
  }

  @Get('admin/vendors')
  @Permissions('vendors.manage')
  list() {
    return this.prisma.vendor.findMany({ orderBy: { createdAt: 'desc' } });
  }

  @Patch('admin/vendors/:id')
  @Permissions('vendors.manage')
  review(@Param('id') id: string, @Body({ schema: reviewSchema }) body: z.infer<typeof reviewSchema>) {
    return this.prisma.vendor.update({ where: { id }, data: { status: body.status } });
  }
}

@Module({ controllers: [VendorsController] })
export class VendorsModule {}

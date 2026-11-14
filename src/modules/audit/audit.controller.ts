import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { pageMeta } from '../../common/pagination';
import { AuditService } from './audit.service';

const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

@ApiTags('audit')
@Controller('admin/audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Permissions('audit.view')
  async list(@Query({ schema: pageSchema }) query: z.infer<typeof pageSchema>) {
    const [rows, total] = await this.audit.list(query.page, query.pageSize);
    return { data: rows, meta: pageMeta(query.page, query.pageSize, total) };
  }
}

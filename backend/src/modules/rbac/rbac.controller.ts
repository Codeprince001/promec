import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RbacService } from './rbac.service';

@ApiTags('rbac')
@Controller('admin/roles')
export class RbacController {
  constructor(private readonly rbac: RbacService) {}

  @Get()
  @Permissions('users.manage')
  async list() {
    const roles = await this.rbac.listRoles();
    return roles.map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description,
      permissions: role.permissions.map((link) => link.permission.code),
    }));
  }
}

import { Body, Controller, Get, Global, Module, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { patchSchema, SettingsService, type SettingsPatch } from './settings.service';

@ApiTags('settings')
@Controller('admin/settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @Permissions('users.manage')
  view() {
    return this.settings.view();
  }

  @Post()
  @Permissions('users.manage')
  update(@CurrentUser() user: AuthUser, @Body({ schema: patchSchema }) body: SettingsPatch) {
    return this.settings.update(user.sub, body);
  }

  @Post('paystack/test')
  @Permissions('users.manage')
  testPaystack() {
    return this.settings.testPaystack();
  }
}

@Global()
@Module({
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { UsersController } from './users.controller';

@Module({ imports: [RbacModule, AuthModule], controllers: [UsersController] })
export class UsersModule {}

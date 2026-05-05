import { Global, Module } from '@nestjs/common';
import { PermissionsGuard } from './permissions.guard';
import { RolesGuard } from './roles.guard';

@Global()
@Module({
  providers: [PermissionsGuard, RolesGuard],
  exports: [PermissionsGuard, RolesGuard],
})
export class GuardsModule {}

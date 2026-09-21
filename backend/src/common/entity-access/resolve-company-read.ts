import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DataAccessModule, EntityAccessService } from './entity-access.service';

/** Resolve the verified primary membership when callers omit the company.
 * JWT payloads intentionally do not carry a trusted scalar user.entityId.
 */
export async function resolveCompanyRead(
  access: EntityAccessService,
  userId: string | undefined,
  module: DataAccessModule,
  requestedEntityId?: unknown,
): Promise<string> {
  if (!userId) throw new ForbiddenException('Authenticated user is required');
  if (requestedEntityId !== undefined &&
      (typeof requestedEntityId !== 'string' || !requestedEntityId.trim())) {
    throw new BadRequestException('entityId must be a non-empty string');
  }
  const context = await access.getContext(userId, module, requestedEntityId as string | undefined);
  if (context.noAccess || !context.entityId) {
    throw new ForbiddenException('Company read access could not be verified');
  }
  return context.entityId;
}

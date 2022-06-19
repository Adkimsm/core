import type { ExecutionContext } from '@nestjs/common'
import type{ FastifyRequest } from 'fastify'
import { UserModel } from '~/modules/user/user.model'
export function getNestExecutionContextRequest(
  context: ExecutionContext,
): FastifyRequest & { user?: UserModel } & Record<string, any> {
  return context.switchToHttp().getRequest<FastifyRequest>()
}

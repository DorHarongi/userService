import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ServerService } from './server.service';

export const SKIP_SERVER_STATUS_GUARD = 'skipServerStatusGuard';

@Injectable()
export class ServerStatusGuard implements CanActivate {
  constructor(
    private serverService: ServerService,
    private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.get<boolean>(SKIP_SERVER_STATUS_GUARD, context.getHandler())) {
      return true;
    }
    const status = await this.serverService.getServerStatus();
    if (status.status === 'ended') {
      throw new HttpException('Server has ended. No further actions are allowed.', HttpStatus.GONE);
    }
    return true;
  }
}

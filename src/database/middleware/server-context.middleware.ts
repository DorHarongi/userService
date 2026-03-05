import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ServerContextService } from '../services/server-context.service';

const DEFAULT_SERVER_ID = 1;
const HEADER_SERVER_ID = 'x-server-id';

@Injectable()
export class ServerContextMiddleware implements NestMiddleware {
  constructor(private readonly serverContext: ServerContextService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const raw = req.headers[HEADER_SERVER_ID];
    const serverId = raw ? parseInt(String(raw), 10) : DEFAULT_SERVER_ID;
    const safeId = Number.isFinite(serverId) && serverId > 0 ? serverId : DEFAULT_SERVER_ID;
    (req as any).serverId = safeId;
    this.serverContext.run(safeId, () => next());
  }
}

import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import { DbConnectorService } from './db-connector.service';

const DEFAULT_SERVER_ID = 1;

interface ServerContext {
  serverId: number;
}

@Injectable()
export class ServerContextService {
  private readonly storage = new AsyncLocalStorage<ServerContext>();

  constructor(private readonly dbConnectorService: DbConnectorService) {}

  run<T>(serverId: number, fn: () => T): T {
    return this.storage.run({ serverId }, fn);
  }

  getServerId(): number {
    const ctx = this.storage.getStore();
    return ctx?.serverId ?? DEFAULT_SERVER_ID;
  }

  async forEachServer(fn: (serverId: number) => Promise<void>): Promise<void> {
    const serverIds = await this.dbConnectorService.getActiveServerIds();
    for (const id of serverIds) {
      await this.run(id, () => fn(id));
    }
  }
}

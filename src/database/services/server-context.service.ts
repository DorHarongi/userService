import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

const DEFAULT_SERVER_ID = 1;

interface ServerContext {
  serverId: number;
}

@Injectable()
export class ServerContextService {
  private readonly storage = new AsyncLocalStorage<ServerContext>();

  run<T>(serverId: number, fn: () => T): T {
    return this.storage.run({ serverId }, fn);
  }

  getServerId(): number {
    const ctx = this.storage.getStore();
    return ctx?.serverId ?? DEFAULT_SERVER_ID;
  }
}

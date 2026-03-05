import { Injectable } from '@nestjs/common';
import * as mongo from 'mongodb';
import { DbConnectorService } from './db-connector.service';
import { ServerContextService } from './server-context.service';

@Injectable()
export class DbAccessorService {
  constructor(
    private dbConnectorService: DbConnectorService,
    private serverContextService: ServerContextService,
  ) {}

  getCollection(name: string): mongo.Collection {
    const serverId = this.serverContextService.getServerId();
    return this.dbConnectorService.getServerDb(serverId).collection(name);
  }
}

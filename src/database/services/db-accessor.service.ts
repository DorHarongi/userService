import { Inject, Injectable } from '@nestjs/common';
import * as mongo from 'mongodb';
import { DbConnectorService } from './db-connector.service';

@Injectable()
export class DbAccessorService {
    collection: mongo.Collection;
    constructor(private dbConnectorService: DbConnectorService)
    {
        this.collection = this.dbConnectorService.connection.collection('users');
    }
}

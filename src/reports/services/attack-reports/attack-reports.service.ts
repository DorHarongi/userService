import { Injectable } from '@nestjs/common';
import { InsertOneResult } from 'mongodb';
import { DbAccessorService } from '../../../database/services/db-accessor.service';
import { AttackReport } from '../../models/attackReport.entity';

const COLLECTION_NAME = "reports";

@Injectable()
export class AttackReportsService {

    constructor(private dbAccessorService:DbAccessorService){}

    async saveReport(attackReport: AttackReport)
    {
        let result: InsertOneResult = await this.dbAccessorService.getCollection(COLLECTION_NAME).insertOne(attackReport);
        return result.acknowledged;
    }
}

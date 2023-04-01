import { Injectable } from '@nestjs/common';
import { InsertOneResult } from 'mongodb';
import { DbAccessorService } from '../../../database/services/db-accessor.service';
import { AttackReport } from '../../models/attackReport.entity';

const MAX_ATTACK_REPORTS_IN_EACH_PAGE = 10;
const COLLECTION_NAME = "reports";

@Injectable()
export class ReportsService {

    constructor(private dbAccessorService:DbAccessorService){}

    async saveAttackReport(attackReport: AttackReport): Promise<boolean>
    {
        let result: InsertOneResult = await this.dbAccessorService.getCollection(COLLECTION_NAME).insertOne(attackReport);
        return result.acknowledged;
    }

    async getAttackReportsOfUser(username: string, page: number): Promise<AttackReport[]>
    {
        const skip = MAX_ATTACK_REPORTS_IN_EACH_PAGE * (page - 1);
        const limit = MAX_ATTACK_REPORTS_IN_EACH_PAGE;

      return (await this.dbAccessorService.getCollection(COLLECTION_NAME).find({
        $or: [
          { attackerName: username },
          { defenderName: username }
        ]
      }).skip(skip).limit(limit).toArray()) as AttackReport[];
    }
}

import { Injectable } from '@nestjs/common';
import { InsertOneResult } from 'mongodb';
import { AttackReport } from '../../models/attackReport.entity';
import { DbAccessorService } from '../../../database/services/db-accessor.service';
import { AttackReportToClientDTO } from '../../models/attackReportToClientDTO';

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

    async getAttackReportsOfUser(username: string, page: number): Promise<AttackReportToClientDTO[]>
    {
        const skip = MAX_ATTACK_REPORTS_IN_EACH_PAGE * (page - 1);
        const limit = MAX_ATTACK_REPORTS_IN_EACH_PAGE;

      let reportsInPage: AttackReport[] = (await this.dbAccessorService.getCollection(COLLECTION_NAME).find({
        $or: [
          { attackerName: username },
          { defenderName: username }
        ]
      }).sort({ date: -1 }).skip(skip).limit(limit).toArray()) as AttackReport[];

      return reportsInPage.map((attackReport: AttackReport)=>{
        // if user attacked and lost the fight, he shouldnt know anything because his army didnt return.
        if(attackReport.attackerName == username && !attackReport.attackerWon)
        {
          attackReport.defenderTotalArmyDefence = 0;
          attackReport.defenderTotalDefence = 0;
          attackReport.defenderTotalSupportArmyDefence = 0
          attackReport.wallDefence = 0;
          attackReport.defenderTotalTroops = undefined;
          attackReport.defenderTotalLostTroops = undefined;
          attackReport.supportTotalTroops = undefined;
          attackReport.supportTotalLostTroops = undefined;
        }
        return new AttackReportToClientDTO(attackReport); // removes mongoId
      })
    }
}

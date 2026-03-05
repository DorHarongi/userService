import { Injectable } from '@nestjs/common';
import { InsertOneResult, ObjectId } from 'mongodb';
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

    private buildReportQuery(username: string): object {
      return {
        $or: [
          { attackerName: username },
          { defenderName: username, reportType: { $ne: 'spy' } },
          { defenderName: username, reportType: 'spy', attackerWon: false },
        ],
      };
    }

    async getNumberOfAttackReportPages(username: string): Promise<number> {
      const numberOfAttackReports: number = await this.dbAccessorService
      .getCollection(COLLECTION_NAME)
      .countDocuments(this.buildReportQuery(username));
      return Math.ceil(numberOfAttackReports / MAX_ATTACK_REPORTS_IN_EACH_PAGE);
    }

    async getAttackReportsOfUser(username: string, page: number): Promise<AttackReportToClientDTO[]>
    {
      const skip = MAX_ATTACK_REPORTS_IN_EACH_PAGE * (page - 1);
      const limit = MAX_ATTACK_REPORTS_IN_EACH_PAGE;

      let reportsInPage: AttackReport[] = (await this.dbAccessorService.getCollection(COLLECTION_NAME).find(
        this.buildReportQuery(username)
      ).sort({ date: -1 }).skip(skip).limit(limit).toArray()) as AttackReport[];

      return reportsInPage.map((attackReport: AttackReport)=>{
        // If user attacked and lost (PvP only), hide defender info — army didn't return so no intel.
        // Boss reports always show full boss HP/damage.
        if (attackReport.reportType === 'pvp' && attackReport.attackerName === username && !attackReport.attackerWon) {
          attackReport.defenderTotalArmyDefence = 0;
          attackReport.defenderTotalDefence = 0;
          attackReport.defenderTotalSupportArmyDefence = 0;
          attackReport.wallDefence = 0;
          attackReport.defenderTotalTroops = undefined;
          attackReport.defenderTotalLostTroops = undefined;
          attackReport.supportTotalTroops = undefined;
          attackReport.supportTotalLostTroops = undefined;
        }
        return new AttackReportToClientDTO(attackReport, username);
      })
    }

    async getUnreadReportCount(username: string): Promise<number> {
      const unreadAsAttacker = await this.dbAccessorService.getCollection(COLLECTION_NAME).countDocuments({
        attackerName: username,
        readByAttacker: false
      });
      
      const unreadAsDefender = await this.dbAccessorService.getCollection(COLLECTION_NAME).countDocuments({
        defenderName: username,
        readByDefender: false,
        $or: [
          { reportType: { $ne: 'spy' } },
          { reportType: 'spy', attackerWon: false },
        ],
      });
      
      return unreadAsAttacker + unreadAsDefender;
    }

    async markReportAsRead(reportId: string, username: string): Promise<{ success: boolean }> {
      const report = await this.dbAccessorService.getCollection(COLLECTION_NAME).findOne({ _id: new ObjectId(reportId) }) as AttackReport;
      
      if (!report) {
        return { success: false };
      }

      const updateField: any = {};
      if (report.attackerName === username) {
        updateField.readByAttacker = true;
      }
      if (report.defenderName === username) {
        updateField.readByDefender = true;
      }

      if (Object.keys(updateField).length === 0) {
        return { success: false };
      }

      await this.dbAccessorService.getCollection(COLLECTION_NAME).updateOne(
        { _id: new ObjectId(reportId) },
        { $set: updateField }
      );

      return { success: true };
    }
}

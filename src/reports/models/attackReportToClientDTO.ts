import { ResourcesAmounts } from "../../user/models/resourcesAmounts";
import { TroopsAmounts } from "../../user/models/troopsAmounts";
import { AttackReport } from "./attackReport.entity";

export class AttackReportToClientDTO
{
    id: string;
    attackerName: string;
    attackerVillageName: string;

    defenderName: string;
    defenderVillageName: string;

    date: Date;
    attackerWon: boolean; 
    lootedResources: ResourcesAmounts;

    attackerTotalAttack: number;
    defenderTotalDefence: number; // defenderTotalArmyDefence + defenderTotalSupportArmyDefence + wallDefence 
    defenderTotalArmyDefence: number;
    defenderTotalSupportArmyDefence: number;
    wallDefence: number;

    attackerTroops: TroopsAmounts;
    attackerLostTroops: TroopsAmounts;
    defenderTotalTroops:TroopsAmounts;
    defenderTotalLostTroops: TroopsAmounts;
    supportTotalTroops: TroopsAmounts;
    supportTotalLostTroops: TroopsAmounts;
    
    read: boolean;

    constructor(attackReport: AttackReport, viewingUsername?: string)
    {
        this.id = attackReport._id?.toString() || '';
        this.attackerName = attackReport.attackerName;
        this.attackerVillageName = attackReport.attackerVillageName;
        this.defenderName = attackReport.defenderName;
        this.defenderVillageName = attackReport.defenderVillageName;
        this.date = attackReport.date;
        this.attackerWon = attackReport.attackerWon;
        this.lootedResources = attackReport.lootedResources;
        this.attackerTotalAttack = attackReport.attackerTotalAttack;
        this.defenderTotalDefence = attackReport.defenderTotalDefence
        this.defenderTotalArmyDefence = attackReport.defenderTotalArmyDefence;
        this.defenderTotalSupportArmyDefence = attackReport.defenderTotalSupportArmyDefence;
        this.wallDefence = attackReport.wallDefence;
        this.attackerTroops = attackReport.attackerTroops;
        this.attackerLostTroops = attackReport.attackerLostTroops;
        this.defenderTotalTroops = attackReport.defenderTotalTroops;
        this.defenderTotalLostTroops = attackReport.defenderTotalLostTroops;
        this.supportTotalTroops = attackReport.supportTotalTroops;
        this.supportTotalLostTroops = attackReport.supportTotalLostTroops;
        
        // Determine read status based on viewing user
        // For backward compatibility, treat undefined as read (true)
        if (viewingUsername === attackReport.attackerName) {
            this.read = attackReport.readByAttacker !== false;
        } else if (viewingUsername === attackReport.defenderName) {
            this.read = attackReport.readByDefender !== false;
        } else {
            this.read = true;
        }
    }
}

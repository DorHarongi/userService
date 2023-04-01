import { ObjectId } from "mongodb";
import { ResourcesAmounts } from "../../user/models/resourcesAmounts";
import { TroopsAmounts } from "../../user/models/troopsAmounts";
import { IAttackReport } from "./IAttackReport.interface";

export class AttackReport implements IAttackReport
{
    _id: ObjectId;

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

    constructor(
        attackerName: string,
        attackerVillageName: string,
        defenderName: string,
        defenderVillageName: string,
        date: Date,
        attackerWon: boolean,
        lootedResources: ResourcesAmounts,
        attackerTotalAttack: number,
        defenderTotalDefence: number,
        defenderTotalArmyDefence: number,
        defenderTotalSupportArmyDefence: number,
        wallDefence: number,
        attackerTroops: TroopsAmounts,
        attackerLostTroops: TroopsAmounts,
        defenderTotalTroops: TroopsAmounts,
        defenderTotalLostTroops: TroopsAmounts,
        supportTotalTroops: TroopsAmounts,
        supportTotalLostTroops: TroopsAmounts)
    {
        this.attackerName = attackerName;
        this.attackerVillageName = attackerVillageName;
        this.defenderName = defenderName;
        this.defenderVillageName = defenderVillageName;
        this.date = date;
        this.attackerWon = attackerWon;
        this.lootedResources = lootedResources;
        this.attackerTotalAttack = attackerTotalAttack;
        this.defenderTotalDefence = defenderTotalDefence
        this.defenderTotalArmyDefence = defenderTotalArmyDefence;
        this.defenderTotalSupportArmyDefence = defenderTotalSupportArmyDefence;
        this.wallDefence = wallDefence;
        this.attackerTroops = attackerTroops;
        this.attackerLostTroops = attackerLostTroops;
        this.defenderTotalTroops = defenderTotalTroops;
        this.defenderTotalLostTroops = defenderTotalLostTroops;
        this.supportTotalTroops = supportTotalTroops;
        this.supportTotalLostTroops = supportTotalLostTroops;
    }
}

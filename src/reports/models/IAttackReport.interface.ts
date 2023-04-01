import { WithId, Document } from "mongodb";
import { ResourcesAmounts } from "../../user/models/resourcesAmounts";
import { TroopsAmounts } from "../../user/models/troopsAmounts";

export interface IAttackReport extends WithId<Document>
{
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
}
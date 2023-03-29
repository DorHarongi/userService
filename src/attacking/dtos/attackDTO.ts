import { TroopsAmounts } from "../../user/models/troopsAmounts";

export class AttackDTO
{
    defenderName: string;
    attackerName: string;
    attackerVillageIndex: number;
    defenderVillageIndex: number;
    attackingTroops: TroopsAmounts;
}
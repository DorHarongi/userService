import { TroopsAmounts } from "../../user/models/troopsAmounts";
import { ResourcesAmounts } from "../../user/models/resourcesAmounts";

export interface SendSupportDTO {
    senderUsername: string;
    senderVillageIndex: number;
    recipientUsername: string;
    recipientVillageName: string;
    troops: TroopsAmounts;
}

export interface WithdrawSupportDTO {
    ownerUsername: string;
    ownerVillageIndex: number;
    recipientUsername: string;
    recipientVillageName: string;
    troops: TroopsAmounts;
}

export interface SendResourcesDTO {
    senderUsername: string;
    senderVillageIndex: number;
    recipientUsername: string;
    recipientVillageName: string;
    resources: ResourcesAmounts;
}

export interface CreateVillageDTO {
    username: string;
    sourceVillageIndex: number;
    newVillageName: string;
    x: number;
    y: number;
}

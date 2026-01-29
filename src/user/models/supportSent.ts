import { TroopsAmounts } from "./troopsAmounts";

export interface SupportSentEntry {
    recipientUsername: string;
    recipientVillageName: string;
    troops: TroopsAmounts;
}

export type SupportSent = SupportSentEntry[];

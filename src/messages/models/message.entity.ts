import { ObjectId } from "mongodb";

export enum MessageType {
    CLAN_JOIN_REQUEST = "clan_join_request",
    CLAN_REQUEST_ACCEPTED = "clan_request_accepted",
    CLAN_REQUEST_DECLINED = "clan_request_declined",
    PLAYER_MESSAGE = "player_message",
    SYSTEM_MESSAGE = "system_message",
    RESOURCES_SENT = "resources_sent",
    RESOURCES_RECEIVED = "resources_received",
    SUPPORT_SENT = "support_sent",
    SUPPORT_RECEIVED = "support_received",
    SUPPORT_WITHDRAWN = "support_withdrawn",
    BOSS_DEFEATED = "boss_defeated",
    OASIS_RETURN = "oasis_return"
}

export interface ResourcesMetadata {
    wood: number;
    stone: number;
    crop: number;
    senderVillageName?: string;
    recipientVillageName?: string;
}

export interface TroopsMetadata {
    spearFighters: number;
    swordFighters: number;
    axeFighters: number;
    archers: number;
    magicians: number;
    horsemen: number;
    catapults: number;
    senderVillageName?: string;
    recipientVillageName?: string;
}

export interface BossRewardMetadata {
    rewardId: string; // Unique ID to match with pending reward
    bossName: string;
    rewardAmount: number;
}

export interface IMessage {
    _id?: ObjectId;
    recipientUsername: string;
    senderUsername?: string; // Optional for system messages
    type: MessageType;
    subject: string;
    content: string;
    date: Date;
    read: boolean;
    actionable: boolean; // Can the user take action (accept/decline)?
    metadata?: {
        clanName?: string;
        requestUsername?: string;
        resources?: ResourcesMetadata;
        troops?: TroopsMetadata;
        bossReward?: BossRewardMetadata;
    };
}

export class Message implements IMessage {
    _id?: ObjectId;
    recipientUsername: string;
    senderUsername?: string;
    type: MessageType;
    subject: string;
    content: string;
    date: Date;
    read: boolean;
    actionable: boolean;
    metadata?: {
        clanName?: string;
        requestUsername?: string;
        resources?: ResourcesMetadata;
        troops?: TroopsMetadata;
        bossReward?: BossRewardMetadata;
    };

    constructor(
        recipientUsername: string,
        type: MessageType,
        subject: string,
        content: string,
        actionable: boolean = false,
        senderUsername?: string,
        metadata?: { 
            clanName?: string; 
            requestUsername?: string;
            resources?: ResourcesMetadata;
            troops?: TroopsMetadata;
            bossReward?: BossRewardMetadata;
        }
    ) {
        this.recipientUsername = recipientUsername;
        this.senderUsername = senderUsername;
        this.type = type;
        this.subject = subject;
        this.content = content;
        this.date = new Date();
        this.read = false;
        this.actionable = actionable;
        this.metadata = metadata;
    }
}

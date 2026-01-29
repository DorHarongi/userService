import { ObjectId } from "mongodb";

export enum MessageType {
    CLAN_JOIN_REQUEST = "clan_join_request",
    CLAN_REQUEST_ACCEPTED = "clan_request_accepted",
    CLAN_REQUEST_DECLINED = "clan_request_declined",
    PLAYER_MESSAGE = "player_message",
    SYSTEM_MESSAGE = "system_message"
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
    };

    constructor(
        recipientUsername: string,
        type: MessageType,
        subject: string,
        content: string,
        actionable: boolean = false,
        senderUsername?: string,
        metadata?: { clanName?: string; requestUsername?: string }
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

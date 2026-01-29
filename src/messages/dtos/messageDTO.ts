import { Message, MessageType } from "../models/message.entity";

export class MessageDTO {
    id: string;
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

    constructor(message: Message) {
        this.id = message._id?.toString() || '';
        this.recipientUsername = message.recipientUsername;
        this.senderUsername = message.senderUsername;
        this.type = message.type;
        this.subject = message.subject;
        this.content = message.content;
        this.date = message.date;
        this.read = message.read;
        this.actionable = message.actionable;
        this.metadata = message.metadata;
    }
}

export interface SendMessageDTO {
    senderUsername: string;
    recipientUsername: string;
    subject: string;
    content: string;
}

export interface MarkReadDTO {
    messageId: string;
    username: string;
}

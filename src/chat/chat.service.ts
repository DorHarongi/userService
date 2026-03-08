import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DbAccessorService } from '../database/services/db-accessor.service';
import { ServerContextService } from '../database/services/server-context.service';

const CHAT_COLLECTION = 'chatMessages';

export interface ChatMessage {
    clanName: string;
    senderUsername: string;
    senderRole: 'leader' | 'member';
    content: string;
    date: Date;
}

@Injectable()
export class ChatService {
    constructor(
        private dbAccessorService: DbAccessorService,
        private serverContextService: ServerContextService,
    ) {}

    async saveChatMessage(clanName: string, senderUsername: string, senderRole: 'leader' | 'member', content: string): Promise<void> {
        const message: ChatMessage = {
            clanName,
            senderUsername,
            senderRole,
            content,
            date: new Date(),
        };
        await this.dbAccessorService.getCollection(CHAT_COLLECTION).insertOne(message);
    }

    async getChatHistory(clanName: string, page: number = 1, pageSize: number = 50): Promise<ChatMessage[]> {
        const skip = (page - 1) * pageSize;
        const cursor = this.dbAccessorService
            .getCollection(CHAT_COLLECTION)
            .find({ clanName })
            .sort({ date: -1 })
            .skip(skip)
            .limit(pageSize);
        const raw = await cursor.toArray();
        const messages = raw.map((doc: any) => ({
            clanName: doc.clanName,
            senderUsername: doc.senderUsername,
            senderRole: doc.senderRole,
            content: doc.content,
            date: doc.date,
        })) as ChatMessage[];
        return messages.reverse();
    }

    @Cron('0 0 * * *')
    async cleanOldMessages(): Promise<void> {
        await this.serverContextService.forEachServer(async () => {
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            await this.dbAccessorService
                .getCollection(CHAT_COLLECTION)
                .deleteMany({ date: { $lt: sevenDaysAgo } });
        });
    }
}


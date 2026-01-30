import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ObjectId } from 'mongodb';
import { DbAccessorService } from '../../database/services/db-accessor.service';
import { Message, MessageType, IMessage, ResourcesMetadata, TroopsMetadata } from '../models/message.entity';
import { MessageDTO, SendMessageDTO } from '../dtos/messageDTO';

const MESSAGES_COLLECTION = "messages";
const MAX_MESSAGES_PER_PAGE = 10;
const MAX_MESSAGE_LENGTH = 100;

@Injectable()
export class MessagesService {
    constructor(private dbAccessorService: DbAccessorService) {}

    async sendMessage(sendMessageDTO: SendMessageDTO): Promise<MessageDTO> {
        // Validate sender
        if (!sendMessageDTO.senderUsername) {
            throw new HttpException("Sender username is required", HttpStatus.BAD_REQUEST);
        }

        // Validate recipient
        if (!sendMessageDTO.recipientUsername) {
            throw new HttpException("Recipient username is required", HttpStatus.BAD_REQUEST);
        }

        // Validate message length
        if (!sendMessageDTO.content || sendMessageDTO.content.trim().length === 0) {
            throw new HttpException("Message cannot be empty", HttpStatus.BAD_REQUEST);
        }
        
        if (sendMessageDTO.content.length > MAX_MESSAGE_LENGTH) {
            throw new HttpException(`Message cannot exceed ${MAX_MESSAGE_LENGTH} characters`, HttpStatus.BAD_REQUEST);
        }

        // Cannot message yourself
        if (sendMessageDTO.senderUsername === sendMessageDTO.recipientUsername) {
            throw new HttpException("You cannot send a message to yourself", HttpStatus.BAD_REQUEST);
        }

        const message = new Message(
            sendMessageDTO.recipientUsername,
            MessageType.PLAYER_MESSAGE,
            sendMessageDTO.subject || `Message from ${sendMessageDTO.senderUsername}`,
            sendMessageDTO.content.trim(),
            false,
            sendMessageDTO.senderUsername
        );

        const result = await this.dbAccessorService.getCollection(MESSAGES_COLLECTION).insertOne(message);
        message._id = result.insertedId;
        return new MessageDTO(message);
    }

    async sendClanJoinRequestMessage(leaderUsername: string, requestUsername: string, clanName: string, introMessage: string): Promise<void> {
        const message = new Message(
            leaderUsername,
            MessageType.CLAN_JOIN_REQUEST,
            `Clan Join Request from ${requestUsername}`,
            introMessage || `${requestUsername} wants to join your clan ${clanName}.`,
            true, // actionable
            requestUsername,
            { clanName, requestUsername }
        );

        await this.dbAccessorService.getCollection(MESSAGES_COLLECTION).insertOne(message);
    }

    async sendClanRequestResponseMessage(username: string, clanName: string, accepted: boolean): Promise<void> {
        const message = new Message(
            username,
            accepted ? MessageType.CLAN_REQUEST_ACCEPTED : MessageType.CLAN_REQUEST_DECLINED,
            accepted ? `Welcome to ${clanName}!` : `Clan Request Declined`,
            accepted 
                ? `Your request to join ${clanName} has been accepted. Welcome to the clan!`
                : `Your request to join ${clanName} has been declined.`,
            false // not actionable - just informational
        );

        await this.dbAccessorService.getCollection(MESSAGES_COLLECTION).insertOne(message);
    }

    async getNumberOfMessagePages(username: string, type?: 'messages' | 'reports'): Promise<number> {
        let filter: any = { recipientUsername: username };
        
        if (type === 'messages') {
            filter.type = { $in: [
                MessageType.PLAYER_MESSAGE, 
                MessageType.CLAN_JOIN_REQUEST, 
                MessageType.CLAN_REQUEST_ACCEPTED, 
                MessageType.CLAN_REQUEST_DECLINED, 
                MessageType.SYSTEM_MESSAGE,
                MessageType.RESOURCES_SENT,
                MessageType.RESOURCES_RECEIVED,
                MessageType.SUPPORT_SENT,
                MessageType.SUPPORT_RECEIVED
            ] };
        }

        const result = await this.dbAccessorService.getCollection(MESSAGES_COLLECTION)
            .aggregate([
                { $match: filter },
                { $count: "total" }
            ]).toArray();
        
        const count = result.length > 0 ? result[0].total : 0;
        return Math.ceil(count / MAX_MESSAGES_PER_PAGE) || 1;
    }

    async getMessages(username: string, page: number, type?: 'messages' | 'reports'): Promise<MessageDTO[]> {
        let filter: any = { recipientUsername: username };
        
        if (type === 'messages') {
            filter.type = { $in: [
                MessageType.PLAYER_MESSAGE, 
                MessageType.CLAN_JOIN_REQUEST, 
                MessageType.CLAN_REQUEST_ACCEPTED, 
                MessageType.CLAN_REQUEST_DECLINED, 
                MessageType.SYSTEM_MESSAGE,
                MessageType.RESOURCES_SENT,
                MessageType.RESOURCES_RECEIVED,
                MessageType.SUPPORT_SENT,
                MessageType.SUPPORT_RECEIVED
            ] };
        }

        const skip = MAX_MESSAGES_PER_PAGE * (page - 1);
        const messages = await this.dbAccessorService.getCollection(MESSAGES_COLLECTION)
            .find(filter)
            .sort({ date: -1 })
            .skip(skip)
            .limit(MAX_MESSAGES_PER_PAGE)
            .toArray() as Message[];

        return messages.map(m => new MessageDTO(m));
    }

    async markAsRead(messageId: string, username: string): Promise<{ success: boolean }> {
        const result = await this.dbAccessorService.getCollection(MESSAGES_COLLECTION).updateOne(
            { _id: new ObjectId(messageId), recipientUsername: username },
            { $set: { read: true } }
        );
        return { success: result.modifiedCount === 1 };
    }

    async deleteMessage(messageId: string, username: string): Promise<{ success: boolean }> {
        const result = await this.dbAccessorService.getCollection(MESSAGES_COLLECTION).deleteOne(
            { _id: new ObjectId(messageId), recipientUsername: username }
        );
        return { success: result.deletedCount === 1 };
    }

    async markClanRequestAsHandled(leaderUsername: string, requestUsername: string, clanName: string): Promise<void> {
        // Mark the clan join request message as non-actionable after being handled
        await this.dbAccessorService.getCollection(MESSAGES_COLLECTION).updateOne(
            { 
                recipientUsername: leaderUsername,
                type: MessageType.CLAN_JOIN_REQUEST,
                "metadata.requestUsername": requestUsername,
                "metadata.clanName": clanName
            },
            { $set: { actionable: false, read: true } }
        );
    }

    async getUnreadMessageCount(username: string): Promise<number> {
        // For backward compatibility, treat undefined/null 'read' field as read (true)
        // So we only count where read is explicitly false
        const count = await this.dbAccessorService.getCollection(MESSAGES_COLLECTION).countDocuments({
            recipientUsername: username,
            read: false
        });
        return count;
    }

    async sendClanNotificationMessage(username: string, subject: string, content: string): Promise<void> {
        const message = new Message(
            username,
            MessageType.SYSTEM_MESSAGE,
            subject,
            content,
            false // not actionable
        );

        await this.dbAccessorService.getCollection(MESSAGES_COLLECTION).insertOne(message);
    }

    async sendResourceTransferMessage(
        senderUsername: string,
        recipientUsername: string,
        senderVillageName: string,
        recipientVillageName: string,
        resources: ResourcesMetadata,
        isSenderMessage: boolean
    ): Promise<void> {
        const resourcesData: ResourcesMetadata = {
            ...resources,
            senderVillageName,
            recipientVillageName
        };

        if (isSenderMessage) {
            // Message for sender
            const message = new Message(
                senderUsername,
                MessageType.RESOURCES_SENT,
                `Resources sent to ${recipientUsername}`,
                `You sent resources to ${recipientUsername} (${recipientVillageName})`,
                false,
                senderUsername,
                { resources: resourcesData }
            );
            await this.dbAccessorService.getCollection(MESSAGES_COLLECTION).insertOne(message);
        } else {
            // Message for recipient
            const message = new Message(
                recipientUsername,
                MessageType.RESOURCES_RECEIVED,
                `Resources received from ${senderUsername}`,
                `You received resources from ${senderUsername} (${senderVillageName})`,
                false,
                senderUsername,
                { resources: resourcesData }
            );
            await this.dbAccessorService.getCollection(MESSAGES_COLLECTION).insertOne(message);
        }
    }

    async sendSupportTroopsMessage(
        senderUsername: string,
        recipientUsername: string,
        senderVillageName: string,
        recipientVillageName: string,
        troops: TroopsMetadata,
        isSenderMessage: boolean
    ): Promise<void> {
        const troopsData: TroopsMetadata = {
            ...troops,
            senderVillageName,
            recipientVillageName
        };

        if (isSenderMessage) {
            // Message for sender
            const message = new Message(
                senderUsername,
                MessageType.SUPPORT_SENT,
                `Support troops sent to ${recipientUsername}`,
                `You sent support troops to ${recipientUsername} (${recipientVillageName})`,
                false,
                senderUsername,
                { troops: troopsData }
            );
            await this.dbAccessorService.getCollection(MESSAGES_COLLECTION).insertOne(message);
        } else {
            // Message for recipient
            const message = new Message(
                recipientUsername,
                MessageType.SUPPORT_RECEIVED,
                `Support troops received from ${senderUsername}`,
                `You received support troops from ${senderUsername} (${senderVillageName})`,
                false,
                senderUsername,
                { troops: troopsData }
            );
            await this.dbAccessorService.getCollection(MESSAGES_COLLECTION).insertOne(message);
        }
    }
}

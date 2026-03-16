import {
    ConnectedSocket,
    MessageBody,
    OnGatewayConnection,
    OnGatewayDisconnect,
    SubscribeMessage,
    WebSocketGateway,
    WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';
import { DbAccessorService } from '../database/services/db-accessor.service';
import { ServerContextService } from '../database/services/server-context.service';
import { User } from '../user/models/user.entity';
import { IClan } from '../clans/models/clan.entity';
import { AuthService } from '../auth/services/auth.service';

interface JoinClanPayload {
    clanName: string;
}

interface SendMessagePayload {
    clanName: string;
    content: string;
}

@WebSocketGateway({
    namespace: '/chat',
    cors: {
        origin: '*',
    },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;

    constructor(
        private chatService: ChatService,
        private dbAccessorService: DbAccessorService,
        private serverContextService: ServerContextService,
        private authService: AuthService,
    ) {}

    async handleConnection(client: Socket): Promise<void> {
        const token = client.handshake.auth?.token || client.handshake.headers['authorization'];
        if (!token || typeof token !== 'string') {
            client.disconnect();
            return;
        }

        const username = await this.validateTokenAndGetUsername(token);
        if (!username) {
            client.disconnect();
            return;
        }

        const rawServerId = client.handshake.auth?.serverId;
        const serverId = rawServerId ? parseInt(String(rawServerId), 10) : 1;

        (client as any).username = username;
        (client as any).serverId = Number.isFinite(serverId) && serverId > 0 ? serverId : 1;
    }

    handleDisconnect(client: Socket): void {
        // Nothing special for now
    }

    @SubscribeMessage('joinClan')
    async handleJoinClan(
        @ConnectedSocket() client: Socket,
        @MessageBody() payload: JoinClanPayload,
    ): Promise<void> {
        const username = (client as any).username;
        const serverId = (client as any).serverId || 1;
        if (!username || !payload?.clanName) {
            return;
        }

        await this.serverContextService.run(serverId, async () => {
            const user = await this.dbAccessorService
                .getCollection('users')
                .findOne({ username }) as User;
            if (!user || user.clanName !== payload.clanName) {
                return;
            }

            client.join(payload.clanName);
        });
    }

    @SubscribeMessage('sendMessage')
    async handleSendMessage(
        @ConnectedSocket() client: Socket,
        @MessageBody() payload: SendMessagePayload,
    ): Promise<void> {
        const username = (client as any).username;
        const serverId = (client as any).serverId || 1;
        if (!username || !payload?.clanName || !payload?.content) {
            return;
        }

        await this.serverContextService.run(serverId, async () => {
            const user = await this.dbAccessorService
                .getCollection('users')
                .findOne({ username }) as User;

            if (!user || user.clanName !== payload.clanName) {
                return;
            }
            const clan = await this.dbAccessorService
                .getCollection('clans')
                .findOne({ clanName: payload.clanName }) as IClan;

            const senderRole: 'leader' | 'member' =
                clan && clan.leaderUsername === username ? 'leader' : 'member';

            await this.chatService.saveChatMessage(payload.clanName, username, senderRole, payload.content);

            this.server.to(payload.clanName).emit('message', {
                clanName: payload.clanName,
                senderUsername: username,
                senderRole,
                content: payload.content,
                date: new Date(),
            });
        });
    }

    private async validateTokenAndGetUsername(token: string): Promise<string | null> {
        // Very small JWT validation stub: expect "Bearer <username>"
        try {
            let raw = token;
            if (raw.startsWith('Bearer ')) {
                raw = raw.substring(7);
            }
            const payload = this.authService.verifyToken(raw);
            return payload.username;
        } catch {
            return null;
        }
    }
}


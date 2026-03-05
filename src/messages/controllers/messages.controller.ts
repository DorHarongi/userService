import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards, Request } from '@nestjs/common';
import { MessagesService } from '../services/messages.service';
import { MessageDTO, SendMessageDTO } from '../dtos/messageDTO';
import { AuthGuard } from '../../auth/guards/auth.guard';
import { ServerStatusGuard } from '../../server/server-status.guard';

@Controller('messages')
@UseGuards(AuthGuard)
export class MessagesController {
    constructor(private messagesService: MessagesService) {}

    @Post('send')
    @UseGuards(ServerStatusGuard)
    async sendMessage(@Request() req: any, @Body() sendMessageDTO: SendMessageDTO): Promise<MessageDTO> {
        sendMessageDTO.senderUsername = req.user.username;
        return await this.messagesService.sendMessage(sendMessageDTO);
    }

    @Get(':username/pages')
    async getNumberOfMessagePages(
        @Request() req: any,
        @Param('username') username: string,
        @Query('type') type?: 'messages' | 'reports'
    ): Promise<number> {
        // Verify user can only access their own messages
        const authUsername = req.user.username;
        if (authUsername !== username) {
            return 0;
        }
        return await this.messagesService.getNumberOfMessagePages(username, type);
    }

    @Get(':username/page/:page')
    async getMessages(
        @Request() req: any,
        @Param('username') username: string,
        @Param('page') page: number,
        @Query('type') type?: 'messages' | 'reports'
    ): Promise<MessageDTO[]> {
        // Verify user can only access their own messages
        const authUsername = req.user.username;
        if (authUsername !== username) {
            return [];
        }
        return await this.messagesService.getMessages(username, page, type);
    }

    @Post('read')
    @UseGuards(ServerStatusGuard)
    async markAsRead(@Request() req: any, @Body() body: { messageId: string; username: string }): Promise<{ success: boolean }> {
        // Use authenticated username
        return await this.messagesService.markAsRead(body.messageId, req.user.username);
    }

    @Delete(':messageId/:username')
    @UseGuards(ServerStatusGuard)
    async deleteMessage(
        @Request() req: any,
        @Param('messageId') messageId: string,
        @Param('username') username: string
    ): Promise<{ success: boolean }> {
        // Use authenticated username
        return await this.messagesService.deleteMessage(messageId, req.user.username);
    }

    @Get(':username/unread')
    async getUnreadMessageCount(@Request() req: any, @Param('username') username: string): Promise<number> {
        // Verify user can only access their own messages
        const authUsername = req.user.username;
        if (authUsername !== username) {
            return 0;
        }
        return await this.messagesService.getUnreadMessageCount(username);
    }
}

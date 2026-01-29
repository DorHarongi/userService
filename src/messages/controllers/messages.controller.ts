import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { MessagesService } from '../services/messages.service';
import { MessageDTO, SendMessageDTO } from '../dtos/messageDTO';

@Controller('messages')
export class MessagesController {
    constructor(private messagesService: MessagesService) {}

    @Post('send')
    async sendMessage(@Body() sendMessageDTO: SendMessageDTO): Promise<MessageDTO> {
        return await this.messagesService.sendMessage(sendMessageDTO);
    }

    @Get(':username/pages')
    async getNumberOfMessagePages(
        @Param('username') username: string,
        @Query('type') type?: 'messages' | 'reports'
    ): Promise<number> {
        return await this.messagesService.getNumberOfMessagePages(username, type);
    }

    @Get(':username/page/:page')
    async getMessages(
        @Param('username') username: string,
        @Param('page') page: number,
        @Query('type') type?: 'messages' | 'reports'
    ): Promise<MessageDTO[]> {
        return await this.messagesService.getMessages(username, page, type);
    }

    @Post('read')
    async markAsRead(@Body() body: { messageId: string; username: string }): Promise<{ success: boolean }> {
        return await this.messagesService.markAsRead(body.messageId, body.username);
    }

    @Delete(':messageId/:username')
    async deleteMessage(
        @Param('messageId') messageId: string,
        @Param('username') username: string
    ): Promise<{ success: boolean }> {
        return await this.messagesService.deleteMessage(messageId, username);
    }
}

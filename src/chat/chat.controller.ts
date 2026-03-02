import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ChatService } from './chat.service';
import { AuthGuard } from '../auth/guards/auth.guard';

@Controller('chat')
export class ChatController {
    constructor(private chatService: ChatService) {}

    @Get(':clanName/history')
    @UseGuards(AuthGuard)
    async getHistory(
        @Param('clanName') clanName: string,
        @Query('page') page?: string,
    ) {
        const pageNumber = parseInt(page || '1', 10) || 1;
        return this.chatService.getChatHistory(clanName, pageNumber);
    }
}


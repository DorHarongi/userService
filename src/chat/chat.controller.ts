import { Controller, Get, Param, Query, Request, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { ChatService } from './chat.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { DbAccessorService } from '../database/services/db-accessor.service';

@Controller('chat')
export class ChatController {
    constructor(
        private chatService: ChatService,
        private dbAccessorService: DbAccessorService,
    ) {}

    @Get(':clanName/history')
    @UseGuards(AuthGuard)
    async getHistory(
        @Request() req: any,
        @Param('clanName') clanName: string,
        @Query('page') page?: string,
    ) {
        const user = await this.dbAccessorService.getCollection('users').findOne({ username: req.user.username }) as any;
        if (!user || user.clanName !== clanName) {
            throw new HttpException('You are not a member of this clan', HttpStatus.FORBIDDEN);
        }
        const pageNumber = parseInt(page || '1', 10) || 1;
        return this.chatService.getChatHistory(clanName, pageNumber);
    }
}


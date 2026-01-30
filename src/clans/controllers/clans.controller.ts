import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ClansService } from '../services/clans.service';
import { ClanDTO, ClanStatisticDTO, CreateClanDTO, HandleJoinRequestDTO, JoinClanRequestDTO, LeaveClanDTO, KickMemberDTO, UpdateClanNameDTO } from '../dtos/clanDTO';
import { MessagesService } from '../../messages/services/messages.service';

@Controller('clans')
export class ClansController {
    constructor(
        private clansService: ClansService,
        private messagesService: MessagesService
    ) {}

    @Post('create')
    async createClan(@Body() createClanDTO: CreateClanDTO): Promise<ClanDTO> {
        return await this.clansService.createClan(createClanDTO);
    }

    @Get(':clanName')
    async getClan(@Param('clanName') clanName: string): Promise<ClanDTO> {
        return await this.clansService.getClan(clanName);
    }

    @Get('statistics/pages')
    async getNumberOfClanStatisticsPages(): Promise<number> {
        return await this.clansService.getNumberOfClanStatisticsPages();
    }

    @Get('statistics/page/:page')
    async getClanStatistics(@Param('page') page: number): Promise<ClanStatisticDTO[]> {
        return await this.clansService.getClanStatistics(page);
    }

    @Post('join')
    async requestToJoinClan(@Body() joinRequest: JoinClanRequestDTO): Promise<{ success: boolean }> {
        const result = await this.clansService.requestToJoinClan(joinRequest);
        
        // If it's an open clan and they joined successfully, notify the leader
        const clan = await this.clansService.getClan(joinRequest.clanName);
        if (clan.isOpen) {
            await this.messagesService.sendClanNotificationMessage(
                clan.leaderUsername,
                'New Member Joined',
                `${joinRequest.username} has joined ${joinRequest.clanName}!`
            );
        } else {
            // Closed clan - notify leader of the request
            await this.messagesService.sendClanJoinRequestMessage(
                clan.leaderUsername,
                joinRequest.username,
                joinRequest.clanName,
                joinRequest.message
            );
        }
        
        return result;
    }

    @Post('handle-request')
    async handleJoinRequest(@Body() handleRequest: HandleJoinRequestDTO): Promise<{ success: boolean }> {
        const result = await this.clansService.handleJoinRequest(handleRequest);
        
        // Send message to the requester about the result
        await this.messagesService.sendClanRequestResponseMessage(
            handleRequest.requestUsername,
            handleRequest.clanName,
            handleRequest.accept
        );
        
        // If accepted, notify the leader
        if (handleRequest.accept) {
            await this.messagesService.sendClanNotificationMessage(
                handleRequest.leaderUsername,
                'New Member Joined',
                `${handleRequest.requestUsername} has been accepted to ${handleRequest.clanName}!`
            );
        }
        
        // Mark the join request message as handled
        await this.messagesService.markClanRequestAsHandled(
            handleRequest.leaderUsername,
            handleRequest.requestUsername,
            handleRequest.clanName
        );
        
        return result;
    }

    @Post('leave')
    async leaveClan(@Body() leaveClanDTO: LeaveClanDTO): Promise<{ success: boolean }> {
        return await this.clansService.leaveClan(leaveClanDTO);
    }

    @Post('kick')
    async kickMember(@Body() kickMemberDTO: KickMemberDTO): Promise<{ success: boolean }> {
        const result = await this.clansService.kickMember(
            kickMemberDTO.clanName,
            kickMemberDTO.leaderUsername,
            kickMemberDTO.memberUsername
        );
        
        // Send message to the kicked member
        await this.messagesService.sendClanNotificationMessage(
            kickMemberDTO.memberUsername,
            'Kicked from Clan',
            `You have been kicked from ${kickMemberDTO.clanName}.`
        );
        
        return result;
    }

    @Get(':clanName/members')
    async getClanMembers(@Param('clanName') clanName: string): Promise<string[]> {
        return await this.clansService.getClanMembers(clanName);
    }

    @Post('update-name')
    async updateClanName(@Body() updateClanNameDTO: UpdateClanNameDTO): Promise<{ success: boolean }> {
        return await this.clansService.updateClanName(
            updateClanNameDTO.oldClanName,
            updateClanNameDTO.newClanName,
            updateClanNameDTO.leaderUsername
        );
    }
}

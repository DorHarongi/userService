import { Body, Controller, Get, Param, Post, UseGuards, Request } from '@nestjs/common';
import { ClansService } from '../services/clans.service';
import { ClanDTO, ClanMemberRaidStatsDTO, ClanStatisticDTO, CreateClanDTO, HandleJoinRequestDTO, JoinClanRequestDTO, LeaveClanDTO, KickMemberDTO, UpdateClanNameDTO, ToggleClanOpenDTO, UpdateClanDescriptionDTO } from '../dtos/clanDTO';
import { MessagesService } from '../../messages/services/messages.service';
import { AuthGuard } from '../../auth/guards/auth.guard';
import { ServerStatusGuard } from '../../server/server-status.guard';

@Controller('clans')
export class ClansController {
    constructor(
        private clansService: ClansService,
        private messagesService: MessagesService
    ) {}

    @Post('create')
    @UseGuards(AuthGuard, ServerStatusGuard)
    async createClan(@Request() req: any, @Body() createClanDTO: CreateClanDTO): Promise<ClanDTO> {
        createClanDTO.leaderUsername = req.user.username;
        return await this.clansService.createClan(createClanDTO);
    }

    // Public endpoint - viewing clan info
    @Get(':clanName')
    async getClan(@Param('clanName') clanName: string): Promise<ClanDTO> {
        return await this.clansService.getClan(clanName);
    }

    // Public endpoint - statistics
    @Get('statistics/pages')
    async getNumberOfClanStatisticsPages(): Promise<number> {
        return await this.clansService.getNumberOfClanStatisticsPages();
    }

    // Public endpoint - statistics
    @Get('statistics/page/:page')
    async getClanStatistics(@Param('page') page: number): Promise<ClanStatisticDTO[]> {
        return await this.clansService.getClanStatistics(page);
    }

    @Post('join')
    @UseGuards(AuthGuard, ServerStatusGuard)
    async requestToJoinClan(@Request() req: any, @Body() joinRequest: JoinClanRequestDTO): Promise<{ success: boolean }> {
        joinRequest.username = req.user.username;
        const result = await this.clansService.requestToJoinClan(joinRequest);
        
        // If it's an open clan and they joined successfully, notify the leader
        const clan = await this.clansService.getClan(joinRequest.clanName);
        if (clan.isOpen) {
            await this.messagesService.sendClanNotificationMessage(
                clan.leaderUsername,
                'New Member Joined',
                `{player:${joinRequest.username}} has joined {clan:${joinRequest.clanName}}!`
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
    @UseGuards(AuthGuard, ServerStatusGuard)
    async handleJoinRequest(@Request() req: any, @Body() handleRequest: HandleJoinRequestDTO): Promise<{ success: boolean }> {
        handleRequest.leaderUsername = req.user.username;
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
                `{player:${handleRequest.requestUsername}} has been accepted to {clan:${handleRequest.clanName}}!`
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
    @UseGuards(AuthGuard, ServerStatusGuard)
    async leaveClan(@Request() req: any, @Body() leaveClanDTO: LeaveClanDTO): Promise<{ success: boolean }> {
        leaveClanDTO.username = req.user.username;
        return await this.clansService.leaveClan(leaveClanDTO);
    }

    @Post('kick')
    @UseGuards(AuthGuard, ServerStatusGuard)
    async kickMember(@Request() req: any, @Body() kickMemberDTO: KickMemberDTO): Promise<{ success: boolean }> {
        kickMemberDTO.leaderUsername = req.user.username;
        const result = await this.clansService.kickMember(
            kickMemberDTO.clanName,
            kickMemberDTO.leaderUsername,
            kickMemberDTO.memberUsername
        );
        
        // Send message to the kicked member
        await this.messagesService.sendClanNotificationMessage(
            kickMemberDTO.memberUsername,
            'Kicked from Clan',
            `You have been kicked from {clan:${kickMemberDTO.clanName}}.`
        );
        
        return result;
    }

    // Public endpoint - viewing clan members
    @Get(':clanName/members')
    async getClanMembers(@Param('clanName') clanName: string): Promise<string[]> {
        return await this.clansService.getClanMembers(clanName);
    }

    // Public endpoint - viewing raid stats
    @Get(':clanName/raid-stats')
    async getClanMemberRaidStats(@Param('clanName') clanName: string): Promise<ClanMemberRaidStatsDTO[]> {
        return await this.clansService.getClanMemberRaidStats(clanName);
    }

    @Post('update-name')
    @UseGuards(AuthGuard, ServerStatusGuard)
    async updateClanName(@Request() req: any, @Body() updateClanNameDTO: UpdateClanNameDTO): Promise<{ success: boolean }> {
        updateClanNameDTO.leaderUsername = req.user.username;
        return await this.clansService.updateClanName(
            updateClanNameDTO.oldClanName,
            updateClanNameDTO.newClanName,
            updateClanNameDTO.leaderUsername
        );
    }

    @Post('toggle-open')
    @UseGuards(AuthGuard, ServerStatusGuard)
    async toggleClanOpen(@Request() req: any, @Body() toggleDTO: ToggleClanOpenDTO): Promise<{ success: boolean }> {
        toggleDTO.leaderUsername = req.user.username;
        return await this.clansService.toggleClanOpen(toggleDTO);
    }

    @Post('update-description')
    @UseGuards(AuthGuard, ServerStatusGuard)
    async updateClanDescription(@Request() req: any, @Body() dto: UpdateClanDescriptionDTO): Promise<{ success: boolean }> {
        dto.leaderUsername = req.user.username;
        return await this.clansService.updateClanDescription(dto.clanName, dto.description, dto.leaderUsername);
    }
}

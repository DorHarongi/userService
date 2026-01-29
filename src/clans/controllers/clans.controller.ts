import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ClansService } from '../services/clans.service';
import { ClanDTO, ClanStatisticDTO, CreateClanDTO, HandleJoinRequestDTO, JoinClanRequestDTO, LeaveClanDTO } from '../dtos/clanDTO';

@Controller('clans')
export class ClansController {
    constructor(private clansService: ClansService) {}

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
        return await this.clansService.requestToJoinClan(joinRequest);
    }

    @Post('handle-request')
    async handleJoinRequest(@Body() handleRequest: HandleJoinRequestDTO): Promise<{ success: boolean }> {
        return await this.clansService.handleJoinRequest(handleRequest);
    }

    @Post('leave')
    async leaveClan(@Body() leaveClanDTO: LeaveClanDTO): Promise<{ success: boolean }> {
        return await this.clansService.leaveClan(leaveClanDTO);
    }

    @Get(':clanName/members')
    async getClanMembers(@Param('clanName') clanName: string): Promise<string[]> {
        return await this.clansService.getClanMembers(clanName);
    }
}

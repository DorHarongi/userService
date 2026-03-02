import { Body, Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { RelicsService } from './relics.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { ServerStatusGuard } from '../server/server-status.guard';

export class TransferRelicDTO {
  relicId: string;
  targetUsername: string;
  targetVillageName: string;
}

@Controller('relics')
export class RelicsController {
  constructor(private relicsService: RelicsService) {}

  @Get()
  async getAll() {
    return this.relicsService.getAllRelics();
  }

  @Get('clan/:clanName')
  async getByClan(@Param('clanName') clanName: string) {
    return this.relicsService.getRelicsByClan(clanName);
  }

  @Post('transfer')
  @UseGuards(AuthGuard, ServerStatusGuard)
  async transfer(@Request() req: any, @Body() dto: TransferRelicDTO) {
    return this.relicsService.transferRelic(
      req.user.username,
      dto.relicId,
      dto.targetUsername,
      dto.targetVillageName,
    );
  }
}

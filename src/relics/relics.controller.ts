import { Body, Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { RelicsService, RelicDocument } from './relics.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { ServerStatusGuard } from '../server/server-status.guard';
import { DbAccessorService } from '../database/services/db-accessor.service';

export class TransferRelicDTO {
  relicId: string;
  targetUsername: string;
  targetVillageName: string;
}

@Controller('relics')
export class RelicsController {
  constructor(
    private relicsService: RelicsService,
    private dbAccessorService: DbAccessorService,
  ) {}

  private stripHolderDetails(relics: RelicDocument[], userClanName: string | null): any[] {
    return relics.map(r => {
      if (r.holderClanName && r.holderClanName === userClanName) {
        return r;
      }
      return {
        relicId: r.relicId,
        holderClanName: r.holderClanName,
        holderUsername: null,
        holderVillageName: null,
        transferCooldownUntil: null,
        obtainedAt: r.obtainedAt,
      };
    });
  }

  @Get()
  @UseGuards(AuthGuard)
  async getAll(@Request() req: any) {
    const user = await this.dbAccessorService.getCollection('users').findOne({ username: req.user.username }) as any;
    const userClan = user?.clanName || null;
    const relics = await this.relicsService.getAllRelics();
    return this.stripHolderDetails(relics, userClan);
  }

  @Get('clan/:clanName')
  @UseGuards(AuthGuard)
  async getByClan(@Request() req: any, @Param('clanName') clanName: string) {
    const user = await this.dbAccessorService.getCollection('users').findOne({ username: req.user.username }) as any;
    const userClan = user?.clanName || null;
    const relics = await this.relicsService.getRelicsByClan(clanName);
    return this.stripHolderDetails(relics, userClan);
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

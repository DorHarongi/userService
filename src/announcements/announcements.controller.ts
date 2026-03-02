import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AnnouncementsService } from './announcements.service';
import { AuthGuard } from '../auth/guards/auth.guard';

@Controller('announcements')
export class AnnouncementsController {
  constructor(private announcementsService: AnnouncementsService) {}

  @Get('recent')
  @UseGuards(AuthGuard)
  async getRecent(@Query('limit') limit?: string) {
    const n = limit ? Math.min(100, Math.max(1, parseInt(limit, 10))) : 20;
    return this.announcementsService.getRecent(n);
  }
}

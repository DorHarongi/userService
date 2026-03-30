import { Controller, UseGuards } from '@nestjs/common';
import { ScoutingService } from './scouting.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { ServerStatusGuard } from '../server/server-status.guard';

@Controller('scouting')
@UseGuards(AuthGuard, ServerStatusGuard)
export class ScoutingController {
    constructor(private scoutingService: ScoutingService) {}
}


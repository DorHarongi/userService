import {
    Body,
    Controller,
    Get,
    Param,
    Post,
    Query,
    Request,
    UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import { ServerStatusGuard } from '../server/server-status.guard';
import { OasisService } from './oasis.service';

@Controller('oasis')
@UseGuards(AuthGuard, ServerStatusGuard)
export class OasisController {
    constructor(private oasisService: OasisService) {}

    @Post('garrison')
    async garrison(
        @Request() req: any,
        @Body() body: { villageName: string; oasisId: string; troops: any },
    ) {
        return this.oasisService.garrisonOasis(
            req.user.username,
            body.villageName,
            body.oasisId,
            body.troops || {},
        );
    }

    @Post('retreat')
    async retreat(
        @Request() req: any,
        @Body() body: { villageName: string; oasisId: string },
    ) {
        return this.oasisService.retreatFromOasis(
            req.user.username,
            body.villageName,
            body.oasisId,
        );
    }

    @Post('attack')
    async attack(
        @Request() req: any,
        @Body() body: { villageName: string; oasisId: string; troops: any },
    ) {
        return this.oasisService.attackOasis(
            req.user.username,
            body.villageName,
            body.oasisId,
            body.troops || {},
        );
    }

    @Get('exists/:oasisId')
    async oasisExists(@Param('oasisId') oasisId: string) {
        return this.oasisService.oasisExists(oasisId);
    }

    @Get('info/:oasisId')
    async getOasisInfo(@Request() req: any, @Param('oasisId') oasisId: string) {
        return this.oasisService.getOasisInfo(oasisId, req.user.username);
    }

    @Get('map')
    async getOasesForMap(
        @Query('startX') startX: string,
        @Query('startY') startY: string,
        @Query('size') size?: string,
    ) {
        return this.oasisService.getOasesForMap(
            parseInt(startX || '0', 10),
            parseInt(startY || '0', 10),
            size ? parseInt(size, 10) : 21,
        );
    }

    @Get('minimap')
    async getMinimap() {
        return this.oasisService.getAllOases();
    }
}

import { Body, Controller, Post, UseGuards, Request } from '@nestjs/common';
import { AttackDTO } from '../dtos/attackDTO';
import { AttackingService } from '../services/attacking/attacking.service';
import { AuthGuard } from '../../auth/guards/auth.guard';
import { ServerStatusGuard } from '../../server/server-status.guard';

@Controller('attack')
@UseGuards(AuthGuard, ServerStatusGuard)
export class AttackController {
    constructor(private attackingService: AttackingService){
        
    }
    @Post('')
    async attack(@Request() req: any, @Body() attackDTO: AttackDTO): Promise<AttackDTO>
    {
        // Use authenticated username instead of trusting DTO
        attackDTO.attackerName = req.user.username;
        return await this.attackingService.attack(attackDTO);
    }
}

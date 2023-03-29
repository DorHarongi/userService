import { Body, Controller, Post } from '@nestjs/common';
import { AttackDTO } from '../dtos/attackDTO';
import { AttackingService } from '../services/attacking/attacking.service';

@Controller('attack')
export class AttackController {
    constructor(private attackingService: AttackingService){
        
    }
    @Post('')
    async attack(@Body() attackDTO: AttackDTO): Promise<AttackDTO>
    {
        return await this.attackingService.attack(attackDTO);
    }
}

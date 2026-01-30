import { Body, Controller, Post } from '@nestjs/common';
import { InteractionsService } from '../services/interactions.service';
import { SendSupportDTO, WithdrawSupportDTO, SendResourcesDTO, CreateVillageDTO, RenameVillageDTO } from '../dtos/interactionDTO';
import { UserDTO } from '../../user/dtos/userDTO';

@Controller('interactions')
export class InteractionsController {
    constructor(private interactionsService: InteractionsService) {}

    @Post('send-support')
    async sendSupport(@Body() dto: SendSupportDTO): Promise<UserDTO> {
        return await this.interactionsService.sendSupport(dto);
    }

    @Post('withdraw-support')
    async withdrawSupport(@Body() dto: WithdrawSupportDTO): Promise<UserDTO> {
        return await this.interactionsService.withdrawSupport(dto);
    }

    @Post('send-resources')
    async sendResources(@Body() dto: SendResourcesDTO): Promise<UserDTO> {
        return await this.interactionsService.sendResources(dto);
    }

    @Post('create-village')
    async createVillage(@Body() dto: CreateVillageDTO): Promise<UserDTO> {
        return await this.interactionsService.createNewVillage(dto);
    }

    @Post('rename-village')
    async renameVillage(@Body() dto: RenameVillageDTO): Promise<UserDTO> {
        return await this.interactionsService.renameVillage(dto);
    }
}

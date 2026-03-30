import { Body, Controller, Post, UseGuards, Request } from '@nestjs/common';
import { InteractionsService } from '../services/interactions.service';
import { SendSupportDTO, WithdrawSupportDTO, SendResourcesDTO, CreateVillageDTO, RenameVillageDTO, LearnSkillDTO, ResetSkillsDTO } from '../dtos/interactionDTO';
import { UserDTO } from '../../user/dtos/userDTO';
import { AuthGuard } from '../../auth/guards/auth.guard';
import { ServerStatusGuard } from '../../server/server-status.guard';

@Controller('interactions')
@UseGuards(AuthGuard, ServerStatusGuard)
export class InteractionsController {
    constructor(private interactionsService: InteractionsService) {}

    @Post('send-support')
    async sendSupport(@Request() req: any, @Body() dto: SendSupportDTO): Promise<UserDTO> {
        dto.senderUsername = req.user.username;
        return await this.interactionsService.sendSupport(dto);
    }

    @Post('withdraw-support')
    async withdrawSupport(@Request() req: any, @Body() dto: WithdrawSupportDTO): Promise<UserDTO> {
        dto.ownerUsername = req.user.username;
        return await this.interactionsService.withdrawSupport(dto);
    }

    @Post('check-resource-space')
    async checkResourceSpace(
        @Request() req: any,
        @Body() body: { recipientUsername: string; recipientVillageName: string; resources: { woodAmount: number; stonesAmount: number; cropAmount: number } },
    ): Promise<{ hasSpace: boolean }> {
        return await this.interactionsService.checkResourceSpace(
            req.user.username,
            body.recipientUsername,
            body.recipientVillageName,
            body.resources,
        );
    }

    @Post('send-resources')
    async sendResources(@Request() req: any, @Body() dto: SendResourcesDTO): Promise<UserDTO> {
        dto.senderUsername = req.user.username;
        return await this.interactionsService.sendResources(dto);
    }

    @Post('create-village')
    async createVillage(@Request() req: any, @Body() dto: CreateVillageDTO): Promise<UserDTO> {
        dto.username = req.user.username;
        return await this.interactionsService.createNewVillage(dto);
    }

    @Post('rename-village')
    async renameVillage(@Request() req: any, @Body() dto: RenameVillageDTO): Promise<UserDTO> {
        dto.username = req.user.username;
        return await this.interactionsService.renameVillage(dto);
    }

    @Post('learn-skill')
    async learnSkill(@Request() req: any, @Body() dto: LearnSkillDTO): Promise<UserDTO> {
        dto.username = req.user.username;
        return await this.interactionsService.learnSkill(dto);
    }

    @Post('reset-skills')
    async resetSkills(@Request() req: any, @Body() dto: ResetSkillsDTO): Promise<UserDTO> {
        dto.username = req.user.username;
        return await this.interactionsService.resetSkills(dto);
    }
}

import { Body, Controller, Get, HttpException, HttpStatus, Param, Post, UseGuards, Request } from '@nestjs/common';
import { userFromClientDTO } from '../dtos/userFromClientDTO';
import * as crypto from 'crypto';
import { UserRepositoryService } from '../services/user-repository.service';
import { UserDTO } from '../dtos/userDTO';
import { UserStatisticDTO } from '../dtos/userStatisticDTO';
import { UserVillageRequestDTO } from '../dtos/userVillageRequestDTO';
import { VillageDTO } from '../dtos/villageDTO';
import { AuthService } from '../../auth/services/auth.service';
import { AuthGuard } from '../../auth/guards/auth.guard';
import { ServerStatusGuard } from '../../server/server-status.guard';
import { MovementService } from '../../attacking/services/movement.service';
import { ServerService } from '../../server/server.service';

const MAX_INTRO_LENGTH = 200;
const MAX_USERNAME_LENGTH = 15;
const MIN_USERNAME_LENGTH = 3;

export interface LoginResponseDTO {
    user: UserDTO;
    token: string;
    ttlMinutes: number;
}

export interface RefreshTokenDTO {
    token: string;
}

export interface UpdateIntroDTO {
    username: string;
    intro: string;
}

export interface UpdateTitleDTO {
    username: string;
    title: string | null;
}

export interface UpdateThemeDTO {
    theme: string;
}

@Controller('users')
export class UserController {
    constructor(
        private userRepositorService: UserRepositoryService,
        private authService: AuthService,
        private movementService: MovementService,
        private serverService: ServerService,
    )
    {


    }
    // Public - registration
    @Post('register')
    async registerUser(@Body() userFromClient: userFromClientDTO, @Request() req: any): Promise<LoginResponseDTO>
    {
        const serverId = (req as any)?.serverId ?? 1;
        const closed = await this.serverService.isRegistrationClosed(serverId);
        if (closed) {
            throw new HttpException('Registration is closed for this server', HttpStatus.BAD_REQUEST);
        }
        const trimmedName = (userFromClient.username || '').trim();
        if (!trimmedName || trimmedName.length < MIN_USERNAME_LENGTH) {
            throw new HttpException(`Username must be at least ${MIN_USERNAME_LENGTH} characters`, HttpStatus.BAD_REQUEST);
        }
        if (trimmedName.length > MAX_USERNAME_LENGTH) {
            throw new HttpException(`Username cannot exceed ${MAX_USERNAME_LENGTH} characters`, HttpStatus.BAD_REQUEST);
        }
        userFromClient.username = trimmedName;
        userFromClient.password = crypto.createHash("shake256")
        .update(userFromClient.password)
        .digest("hex");
        const success = await this.userRepositorService.create(userFromClient);
        if (success) {
            // Auto-login after registration
            const user = await this.userRepositorService.getUser(userFromClient.username);
            const token = this.authService.generateToken(userFromClient.username);
            return {
                user,
                token,
                ttlMinutes: this.authService.getTtlMinutes()
            };
        }
        throw new Error('Registration failed');
    }

    // Public - login
    @Post('login')
    async loginUser(@Body() userFromClient: userFromClientDTO): Promise<LoginResponseDTO>
    {
        const user = await this.userRepositorService.login(userFromClient);
        const token = this.authService.generateToken(user.username);
        return {
            user,
            token,
            ttlMinutes: this.authService.getTtlMinutes()
        };
    }

    // Public - token refresh (needs valid token in body)
    @Post('refresh-token')
    async refreshToken(@Body() body: RefreshTokenDTO): Promise<{ token: string; ttlMinutes: number }>
    {
        const newToken = this.authService.refreshToken(body.token);
        return {
            token: newToken,
            ttlMinutes: this.authService.getTtlMinutes()
        };
    }

    // Public - statistics
    @Get('statistics')
    async getNumberOfUserStatisticsPages(): Promise<number>
    {
        return await this.userRepositorService.getNumberOfUserStatisticsPages();
    }

    @Get('statistics/page-for/:username')
    async getUserStatisticsPage(@Param('username') username: string): Promise<{ page: number }>
    {
        const page = await this.userRepositorService.getUserStatisticsPage(username);
        return { page };
    }

    // Public - statistics
    @Get('statistics/:page')
    async getUserStatistics(@Param('page') page: number): Promise<UserStatisticDTO[]>
    {
        return await this.userRepositorService.getUserStatistics(page);
    }

    // Public - player leaderboard by weekly stat category
    @Get('leaderboard/:category')
    async getUserLeaderboard(@Param('category') category: string): Promise<any[]>
    {
        return await this.userRepositorService.getUserLeaderboard(category);
    }

    // Public - clan leaderboard by weekly stat category
    @Get('/clans/leaderboard/:category')
    async getClanLeaderboard(@Param('category') category: string): Promise<any[]>
    {
        return await this.userRepositorService.getClanLeaderboard(category);
    }

    // Public - previous week's leaderboard archive
    @Get('leaderboard-archive')
    async getLeaderboardArchive(): Promise<any> {
        return await this.userRepositorService.getLeaderboardArchive();
    }

    @Post('village')
    @UseGuards(AuthGuard)
    async getVillage(@Request() req: any, @Body() userVillageRequestDTO: UserVillageRequestDTO): Promise<VillageDTO>
    {
        userVillageRequestDTO.username = req.user.username;
        return await this.userRepositorService.getUserVillage(userVillageRequestDTO);
    }

    @Get('movements/:username')
    @UseGuards(AuthGuard)
    async getMovements(@Request() req: any, @Param('username') username: string): Promise<any[]>
    {
        if (req.user.username !== username) {
            throw new HttpException('You can only view your own movements', HttpStatus.FORBIDDEN);
        }
        return await this.movementService.getUserMovements(username);
    }

    @Get(':username')
    @UseGuards(AuthGuard)
    async getUser(@Request() req: any, @Param('username') username: string): Promise<UserDTO>
    {
        // Only allow getting own user data with full details
        if (req.user.username !== username) {
            // For other users, return limited public profile
            return await this.userRepositorService.getPublicProfile(username);
        }
        return await this.userRepositorService.getUser(username);
    }

    // Public - view player profile (limited data)
    @Get('profile/:username')
    async getPlayerProfile(@Param('username') username: string): Promise<UserDTO>
    {
        return await this.userRepositorService.getPublicProfile(username);
    }

    @Post('update-intro')
    @UseGuards(AuthGuard)
    async updateIntro(@Request() req: any, @Body() updateIntroDTO: UpdateIntroDTO): Promise<{ success: boolean }>
    {
        if (updateIntroDTO.intro && updateIntroDTO.intro.length > MAX_INTRO_LENGTH) {
            throw new HttpException(`Intro cannot exceed ${MAX_INTRO_LENGTH} characters`, HttpStatus.BAD_REQUEST);
        }
        // Use authenticated username
        return await this.userRepositorService.updateIntro(req.user.username, updateIntroDTO.intro || '');
    }

    @Post('title')
    @UseGuards(AuthGuard, ServerStatusGuard)
    async updateTitle(@Request() req: any, @Body() body: UpdateTitleDTO): Promise<{ success: boolean }> {
        const title = body.title || null;
        return await this.userRepositorService.updateTitle(req.user.username, title);
    }

    @Post('theme')
    @UseGuards(AuthGuard, ServerStatusGuard)
    async updateTheme(@Request() req: any, @Body() body: UpdateThemeDTO): Promise<{ success: boolean }> {
        return await this.userRepositorService.updateTheme(req.user.username, body.theme || 'default');
    }
}

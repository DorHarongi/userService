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

const MAX_INTRO_LENGTH = 200;

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

@Controller('users')
export class UserController {
    constructor(
        private userRepositorService: UserRepositoryService,
        private authService: AuthService
    )
    {


    }
    // Public - registration
    @Post('register')
    async registerUser(@Body() userFromClient: userFromClientDTO): Promise<LoginResponseDTO>
    {
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

    // Public - statistics
    @Get('statistics/:page')
    async getUserStatistics(@Param('page') page: number): Promise<UserStatisticDTO[]>
    {
        return await this.userRepositorService.getUserStatistics(page);
    }

    @Post('village')
    @UseGuards(AuthGuard)
    async getVillage(@Request() req: any, @Body() userVillageRequestDTO: UserVillageRequestDTO): Promise<VillageDTO>
    {
        userVillageRequestDTO.username = req.user.username;
        return await this.userRepositorService.getUserVillage(userVillageRequestDTO);
    }

    // Protected - get own full user data
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
}

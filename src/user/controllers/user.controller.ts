import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { userFromClientDTO } from '../dtos/userFromClientDTO';
import * as crypto from 'crypto';
import { UserRepositoryService } from '../services/user-repository.service';
import { UserDTO } from '../dtos/userDTO';
import { UserStatisticDTO } from '../dtos/userStatisticDTO';


@Controller('users')
export class UserController {
    constructor(private userRepositorService: UserRepositoryService)
    {


    }
    @Post('register')
    async registerUser(@Body() userFromClient: userFromClientDTO): Promise<boolean>
    {
        userFromClient.password = crypto.createHash("shake256")
        .update(userFromClient.password)
        .digest("hex");
        return await this.userRepositorService.create(userFromClient);
    }

    @Post('login')
    async loginUser(@Body() userFromClient: userFromClientDTO): Promise<UserDTO>
    {
        return await this.userRepositorService.login(userFromClient);
    }

    @Get('statistics/:page')
    async getUserStatistics(@Param('page') page: number): Promise<UserStatisticDTO[]>
    {
        return await this.userRepositorService.getUserStatistics(page);
    }
}

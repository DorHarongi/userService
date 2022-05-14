import { Body, Controller, Post } from '@nestjs/common';
import { userFromClientDTO } from '../models/userFromClientDTO';
import * as crypto from 'crypto';
import { UserRepositoryService } from '../services/user-repository.service';


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
}

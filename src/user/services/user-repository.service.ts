import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InsertOneResult, WithId, Document } from 'mongodb';
import { DbAccessorService } from '../../database/services/db-accessor.service';
import { User } from '../models/user.entity';
import { userFromClientDTO } from '../dtos/userFromClientDTO';
import * as crypto from 'crypto';
import { UserDTO } from '../dtos/userDTO';

@Injectable()
export class UserRepositoryService {
    constructor(private dbAccessorService: DbAccessorService)
    {

    }
    async create(userFromClient: userFromClientDTO): Promise<boolean> {
        const user:User = new User(userFromClient);
        let result: InsertOneResult = await this.dbAccessorService.collection.insertOne(user);
        return result.acknowledged;
    }  

    async login(userFromClient: userFromClientDTO): Promise<UserDTO>{
        userFromClient.password = crypto.createHash("shake256").update(userFromClient.password).digest("hex");
        let result: User = (await this.dbAccessorService.collection.findOne({username: userFromClient.username, password: userFromClient.password})) as User;
        if(!result)
            throw new HttpException("Username or password doesnt exist", HttpStatus.NOT_FOUND);
        return new UserDTO(result);
    }
}

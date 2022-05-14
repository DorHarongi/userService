import { Injectable } from '@nestjs/common';
import { InsertOneResult } from 'mongodb';
import { DbAccessorService } from '../../database/services/db-accessor.service';
import { User } from '../models/user.entity';
import { userFromClientDTO } from '../models/userFromClientDTO';

@Injectable()
export class UserRepositoryService {
    constructor(private dbAccessorService: DbAccessorService)
    {

    }
    async create(userFromClientDTO: userFromClientDTO): Promise<boolean> {
        const user:User = new User(userFromClientDTO);
        let result: InsertOneResult = await this.dbAccessorService.collection.insertOne(user);
        return result.acknowledged;
    }  
}

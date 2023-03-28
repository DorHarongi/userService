import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InsertOneResult, WithId, Document } from 'mongodb';
import { DbAccessorService } from '../../database/services/db-accessor.service';
import { User } from '../models/user.entity';
import { userFromClientDTO } from '../dtos/userFromClientDTO';
import * as crypto from 'crypto';
import { UserDTO } from '../dtos/userDTO';
import { UserStatisticDTO } from '../dtos/userStatisticDTO';

const MAX_USERS_IN_EACH_STATISTICS_PAGE = 10;

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

    async getUserStatistics(page: number): Promise<Array<UserStatisticDTO>>
    {
        let result = this.dbAccessorService.collection.aggregate([
            { "$unwind" : "$villages" },
            { "$group" : {
                "_id" : "$_id",
                 "totalPopulation": { $sum: "$villages.population" },
                 "username": { $first: "$username" },
                 "clanName": { $first: "$clanName" },
                 "numberOfVillages": { $sum: 1}
                  
            }},
            { "$sort" : { "totalPopulation" : -1 } },
            {"$skip": MAX_USERS_IN_EACH_STATISTICS_PAGE * page},
            {"$limit": MAX_USERS_IN_EACH_STATISTICS_PAGE}
        ])

        if(!result)
            throw new HttpException("No users were found", HttpStatus.NOT_FOUND);
        
        let usersWithMongoId: any =  await result.toArray();
        let users: UserStatisticDTO[] = usersWithMongoId.map(userWithMongoId =>{
            return {
                'username': userWithMongoId.username,
                'population': userWithMongoId.totalPopulation,
                'clanName': userWithMongoId.clanName,
                'numberOfVillages': userWithMongoId.numberOfVillages
            }
        })

        return users;
    }
}

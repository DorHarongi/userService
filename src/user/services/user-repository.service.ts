import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InsertOneResult, WithId, Document } from 'mongodb';
import { DbAccessorService } from '../../database/services/db-accessor.service';
import { User } from '../models/user.entity';
import { userFromClientDTO } from '../dtos/userFromClientDTO';
import * as crypto from 'crypto';
import { UserDTO } from '../dtos/userDTO';
import { VillageDTO } from '../dtos/villageDTO';
import { singleWorkerProductionSpeedPerSecond, factoriesProductionLevelByLevel } from 'utils';

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

        let userDTO: UserDTO = {
            username: result.username,
            joinDate: result.joinDate,
            clanName: result.clanName,
            villages: result.villages as VillageDTO[]
        }

        for(let village of userDTO.villages)
        {
            village.woodProductionPerSecond =  factoriesProductionLevelByLevel[village.buildingsLevels.woodFactoryLevel] + village.resourcesWorkers.woodWorkers * singleWorkerProductionSpeedPerSecond ;
            village.stoneProductionPerSecond = factoriesProductionLevelByLevel[village.buildingsLevels.stoneMineLevel] + village.resourcesWorkers.stoneWorkers * singleWorkerProductionSpeedPerSecond;
            village.cropProductionPerSecond = factoriesProductionLevelByLevel[village.buildingsLevels.cropFarmLevel] + village.resourcesWorkers.cropWorkers * singleWorkerProductionSpeedPerSecond;
        }
        return userDTO;
    }
}

import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { UpdateResult } from 'mongodb';
import { Village } from 'src/user/models/village.entity';
import { DbAccessorService } from '../../database/services/db-accessor.service';
import { UserDTO } from '../../user/dtos/userDTO';
import { User } from '../../user/models/user.entity';
import { WorkersDTO } from '../dtos/workersDTO';
import { quartersPopulationByLevel} from 'utils';
import { ResourcesWorkers } from '../../user/models/resourcesWorkers';

const USER_COLLECTIONS = "users";

@Injectable()
export class WorkersService {
    
    constructor(private dbAccessorService: DbAccessorService)
    {

    }
    
    async hireWorkers(workersDTO: WorkersDTO): Promise<UserDTO>{
        const user: User = (await this.dbAccessorService.getCollection(USER_COLLECTIONS).findOne({username: workersDTO.username})) as User;
        if(!user)
            throw new HttpException("Username doesnt exist", HttpStatus.NOT_FOUND);
        const village: Village = user.villages[workersDTO.villageIndex];
        if(!village)
            throw new HttpException("Village doesnt exist", HttpStatus.NOT_FOUND);


        //check if user have enough free population for this amount of workers

        let freePopulation: number = this.calculateFreePopulationInVillage(village);
        if(!this.checkIfVillageHasEnoughFreePopulation(freePopulation, workersDTO.resourcesWorkers))
            throw new HttpException("You tried to hire too many workers", HttpStatus.FORBIDDEN);    
    
        // everything good -> changeWorkers workers

        this.addWorkersToVillage(village, workersDTO.resourcesWorkers);
        const updateResult: UpdateResult = await this.dbAccessorService.getCollection(USER_COLLECTIONS).updateOne({username: workersDTO.username}, {$set: user});
        return new UserDTO(user);
    }

    addWorkersToVillage(village: Village, resourcesWorkers: ResourcesWorkers): void
    {
        village.resourcesWorkers.cropWorkers += resourcesWorkers.cropWorkers;
        village.resourcesWorkers.stoneWorkers += resourcesWorkers.stoneWorkers;
        village.resourcesWorkers.woodWorkers += resourcesWorkers.woodWorkers;
        this.fixNegativeWorkerNumbers(village.resourcesWorkers);
    }

    fixNegativeWorkerNumbers(resourcesWorkers: ResourcesWorkers): void
    {
        if(resourcesWorkers.cropWorkers < 0)
            resourcesWorkers.cropWorkers = 0;
        if(resourcesWorkers.stoneWorkers < 0)
            resourcesWorkers.stoneWorkers = 0;
        if(resourcesWorkers.woodWorkers < 0)
            resourcesWorkers.woodWorkers = 0;
    }

    checkIfVillageHasEnoughFreePopulation(freePopulation: number, resourcesWorkers: ResourcesWorkers): boolean
    {
        let totalWorkersToHire = resourcesWorkers.cropWorkers + resourcesWorkers.stoneWorkers + resourcesWorkers.woodWorkers;
        return totalWorkersToHire <= freePopulation;
    }

    calculateFreePopulationInVillage(village: Village): number
    {
        let maximumPopulation: number = quartersPopulationByLevel[village.buildingsLevels.quartersLevel];
        let usedPopulation: number = this.calculateTotalTroops(village) + this.calculateTotalWorkers(village);
        return maximumPopulation - usedPopulation;
    }

    calculateTotalWorkers(village: Village): number
    {
        return village.resourcesWorkers.cropWorkers + village.resourcesWorkers.stoneWorkers + village.resourcesWorkers.woodWorkers;
    }

    calculateTotalTroops(village: Village): number
    {
        return village.troops.archers + village.troops.axeFighters + village.troops.catapults + village.troops.horsemen + village.troops.magicians + village.troops.spearFighters 
        + village.troops.swordFighters; 
    }

}

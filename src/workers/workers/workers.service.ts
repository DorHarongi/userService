import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { UpdateResult } from 'mongodb';
import { Village } from 'src/user/models/village.entity';
import { DbAccessorService } from '../../database/services/db-accessor.service';
import { QuestAwareResponse } from '../../quests/quest-response.dto';
import { QuestService } from '../../quests/quest.service';
import { UserDTO } from '../../user/dtos/userDTO';
import { ResourcesWorkers } from '../../user/models/resourcesWorkers';
import { User } from '../../user/models/user.entity';
import { WorkersDTO } from '../dtos/workersDTO';

const USER_COLLECTIONS = 'users';

@Injectable()
export class WorkersService {
  constructor(
    private dbAccessorService: DbAccessorService,
    private questService: QuestService,
  ) {}

  async hireWorkers(workersDTO: WorkersDTO): Promise<QuestAwareResponse> {
    const user: User = (await this.dbAccessorService
      .getCollection(USER_COLLECTIONS)
      .findOne({ username: workersDTO.username })) as User;
    if (!user)
      throw new HttpException('Username doesnt exist', HttpStatus.NOT_FOUND);
    const village: Village = user.villages[workersDTO.villageIndex];
    if (!village)
      throw new HttpException('Village doesnt exist', HttpStatus.NOT_FOUND);

    let freePopulation: number = Village.getFreePopulation(village);
    if (
      !this.checkIfVillageHasEnoughFreePopulation(
        freePopulation,
        workersDTO.resourcesWorkers,
      )
    )
      throw new HttpException(
        'You tried to hire too many workers',
        HttpStatus.FORBIDDEN,
      );

    // everything good -> changeWorkers workers

    this.addWorkersToVillage(village, workersDTO.resourcesWorkers);

    // Check if quest is now claimable (rewards must be claimed manually)
    const isQuestClaimable = this.questService.checkIfQuestNowClaimable(
      user,
      {
        type: 'HIRE_WORKERS',
        totalWorkers: this.calculateTotalWorkers(village),
      },
      workersDTO.villageIndex,
    );

    const updateResult: UpdateResult = await this.dbAccessorService
      .getCollection(USER_COLLECTIONS)
      .updateOne({ username: workersDTO.username }, { $set: user });
    return { user: new UserDTO(user), isQuestClaimable };
  }

  addWorkersToVillage(
    village: Village,
    resourcesWorkers: ResourcesWorkers,
  ): void {
    village.resourcesWorkers.cropWorkers += resourcesWorkers.cropWorkers;
    village.resourcesWorkers.stoneWorkers += resourcesWorkers.stoneWorkers;
    village.resourcesWorkers.woodWorkers += resourcesWorkers.woodWorkers;
    this.fixNegativeWorkerNumbers(village.resourcesWorkers);
  }

  fixNegativeWorkerNumbers(resourcesWorkers: ResourcesWorkers): void {
    if (resourcesWorkers.cropWorkers < 0) resourcesWorkers.cropWorkers = 0;
    if (resourcesWorkers.stoneWorkers < 0) resourcesWorkers.stoneWorkers = 0;
    if (resourcesWorkers.woodWorkers < 0) resourcesWorkers.woodWorkers = 0;
  }

  checkIfVillageHasEnoughFreePopulation(
    freePopulation: number,
    resourcesWorkers: ResourcesWorkers,
  ): boolean {
    let totalWorkersToHire =
      resourcesWorkers.cropWorkers +
      resourcesWorkers.stoneWorkers +
      resourcesWorkers.woodWorkers;
    return totalWorkersToHire <= freePopulation;
  }

  calculateTotalWorkers(village: Village): number {
    return Village.getTotalWorkers(village);
  }
}

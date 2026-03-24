import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Village } from 'src/user/models/village.entity';
import { DbAccessorService } from '../../database/services/db-accessor.service';
import { DailyQuestTrackingType, ClanQuestTrackingType } from 'utils';
import { DailyQuestService } from '../../dailyQuests/daily-quest.service';
import { ClanQuestService } from '../../clanQuests/clan-quest.service';
import { QuestAwareResponse } from '../../quests/quest-response.dto';
import { QuestService } from '../../quests/quest.service';
import { UserDTO } from '../../user/dtos/userDTO';
import { ResourcesWorkers } from '../../user/models/resourcesWorkers';
import { User } from '../../user/models/user.entity';
import { WorkersDTO } from '../dtos/workersDTO';
import { getAccurateFreePopulation, reconcileAllVillages } from '../../user/population-utils';

const USER_COLLECTIONS = 'users';

@Injectable()
export class WorkersService {
  constructor(
    private dbAccessorService: DbAccessorService,
    private questService: QuestService,
    private dailyQuestService: DailyQuestService,
    private clanQuestService: ClanQuestService,
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

    const totalWorkerDelta =
      workersDTO.resourcesWorkers.cropWorkers +
      workersDTO.resourcesWorkers.stoneWorkers +
      workersDTO.resourcesWorkers.woodWorkers;

    if (totalWorkerDelta > 0) {
      const freePopulation = await getAccurateFreePopulation(
        this.dbAccessorService,
        village,
        workersDTO.username,
      );
      if (totalWorkerDelta > freePopulation)
        throw new HttpException(
          'You tried to hire too many workers',
          HttpStatus.FORBIDDEN,
        );
    }

    this.addWorkersToVillage(village, workersDTO.resourcesWorkers);

    const vp = `villages.${workersDTO.villageIndex}`;
    await this.dbAccessorService
      .getCollection(USER_COLLECTIONS)
      .updateOne(
        { username: workersDTO.username },
        {
          $set: {
            [`${vp}.resourcesWorkers`]: village.resourcesWorkers,
          },
        },
      );

    const updatedUser: User = (await this.dbAccessorService
      .getCollection(USER_COLLECTIONS)
      .findOne({ username: workersDTO.username })) as User;

    await reconcileAllVillages(this.dbAccessorService, updatedUser);

    const updatedVillage = updatedUser.villages[workersDTO.villageIndex];

    const isQuestClaimable = this.questService.checkIfQuestNowClaimable(
      updatedUser,
      {
        type: 'HIRE_WORKERS',
        totalWorkers: this.calculateTotalWorkers(updatedVillage),
      },
      workersDTO.villageIndex,
    );

    const totalHired =
      workersDTO.resourcesWorkers.cropWorkers +
      workersDTO.resourcesWorkers.stoneWorkers +
      workersDTO.resourcesWorkers.woodWorkers;

    this.dailyQuestService.incrementProgress(workersDTO.username, DailyQuestTrackingType.HIRE_WORKERS, totalHired).catch(() => {});
    if (updatedUser.clanName) {
      this.clanQuestService.incrementClanProgress(updatedUser.clanName, workersDTO.username, ClanQuestTrackingType.TOTAL_WORKERS_HIRED, totalHired).catch(() => {});
    }

    return { user: new UserDTO(updatedUser), isQuestClaimable };
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

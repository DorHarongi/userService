import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { UpdateResult } from 'mongodb';
import { TroopsAmounts } from 'src/user/models/troopsAmounts';
import {
  archerMaterialsCost,
  archerMinimumArsenalLevel,
  axeFighterMaterialsCost,
  axeFighterMinimumArsenalLevel,
  catapultsMaterialsCost,
  catapultsMinimumArsenalLevel,
  horsemenMaterialsCost,
  horsemenMinimumArsenalLevel,
  magicianMaterialsCost,
  magicianMinimumArsenalLevel,
  MaterialsCost,
  spearFighterMaterialsCost,
  spearFighterMinimumArsenalLevel,
  swordFighterMaterialsCost,
  swordFighterMinimumArsenalLevel,
} from 'utils';
import { DbAccessorService } from '../../../../database/services/db-accessor.service';
import { DailyQuestTrackingType, ClanQuestTrackingType } from 'utils';
import { DailyQuestService } from '../../../../dailyQuests/daily-quest.service';
import { ClanQuestService } from '../../../../clanQuests/clan-quest.service';
import { QuestAwareResponse } from '../../../../quests/quest-response.dto';
import { QuestService } from '../../../../quests/quest.service';
import { TrainDTO } from '../../../../troops/dtos/trainDTO';
import { UserDTO } from '../../../../user/dtos/userDTO';
import { ResourcesAmounts } from '../../../../user/models/resourcesAmounts';
import { User } from '../../../../user/models/user.entity';
import { Village } from '../../../../user/models/village.entity';

const USER_COLLECTIONS = 'users';

@Injectable()
export class TroopsTrainingService {
  constructor(
    private dbAccessorService: DbAccessorService,
    private questService: QuestService,
    private dailyQuestService: DailyQuestService,
    private clanQuestService: ClanQuestService,
  ) {}

  async trainTroops(trainDTO: TrainDTO): Promise<QuestAwareResponse> {
    const user: User = (await this.dbAccessorService
      .getCollection(USER_COLLECTIONS)
      .findOne({ username: trainDTO.username })) as User;
    if (!user)
      throw new HttpException('Username doesnt exist', HttpStatus.NOT_FOUND);
    const village: Village = user.villages[trainDTO.villageIndex];
    if (!village)
      throw new HttpException('Village doesnt exist', HttpStatus.NOT_FOUND);
    if (this.foundNegativeNumbersInDTO(trainDTO))
      throw new HttpException(
        'Cannot train negative troops',
        HttpStatus.BAD_REQUEST,
      );

    //check if user have enough materials for training this amount of troops, and that he is not training troops he cant by his level

    let materialsCost: MaterialsCost = this.calculateMaterialsCostForTraining(
      trainDTO.troopsAmount,
    );
    if (
      !this.doesUserHaveEnoughMaterialsForTraining(
        village.resourcesAmounts,
        materialsCost,
      )
    )
      throw new HttpException(
        'Village does not have enough materials for this training',
        HttpStatus.FORBIDDEN,
      );
    if (
      !this.canUserTrainAllTroopsHeTriedTo(
        village.buildingsLevels.arsenalLevel,
        trainDTO.troopsAmount,
      )
    )
      throw new HttpException(
        'You still cant train some of the troops you tried to',
        HttpStatus.FORBIDDEN,
      );
    let freePopulation: number = Village.getFreePopulation(village);
    if (
      !this.checkIfVillageHasEnoughFreePopulation(
        freePopulation,
        trainDTO.troopsAmount,
      )
    )
      throw new HttpException(
        'You tried to train too many troops',
        HttpStatus.FORBIDDEN,
      );

    // everything good -> train troops and decrease resources

    village.resourcesAmounts.cropAmount -= materialsCost.crop;
    village.resourcesAmounts.stonesAmount -= materialsCost.stones;
    village.resourcesAmounts.woodAmount -= materialsCost.wood;

    this.addTroopsToUser(village.troops, trainDTO.troopsAmount);

    // Check if quest is now claimable (rewards must be claimed manually)
    const isQuestClaimable = this.questService.checkIfQuestNowClaimable(
      user,
      {
        type: 'TRAIN_TROOPS',
        totalTroops: this.calculateTotalTroops(village),
      },
      trainDTO.villageIndex,
    );

    const totalTrained =
      trainDTO.troopsAmount.spearFighters + trainDTO.troopsAmount.swordFighters +
      trainDTO.troopsAmount.axeFighters + trainDTO.troopsAmount.archers +
      trainDTO.troopsAmount.magicians + trainDTO.troopsAmount.horsemen +
      trainDTO.troopsAmount.catapults;

    this.dailyQuestService.incrementProgress(trainDTO.username, DailyQuestTrackingType.TRAIN_TROOPS, totalTrained).catch(() => {});
    if (user.clanName) {
      this.clanQuestService.incrementClanProgress(user.clanName, trainDTO.username, ClanQuestTrackingType.TOTAL_TROOPS_TRAINED, totalTrained).catch(() => {});
    }

    const updateResult: UpdateResult = await this.dbAccessorService
      .getCollection(USER_COLLECTIONS)
      .updateOne({ username: trainDTO.username }, { $set: user });
    return { user: new UserDTO(user), isQuestClaimable };
  }

  foundNegativeNumbersInDTO(trainDTO: TrainDTO) {
    if (trainDTO.troopsAmount.archers < 0) return true;
    if (trainDTO.troopsAmount.axeFighters < 0) return true;
    if (trainDTO.troopsAmount.catapults < 0) return true;
    if (trainDTO.troopsAmount.horsemen < 0) return true;
    if (trainDTO.troopsAmount.magicians < 0) return true;
    if (trainDTO.troopsAmount.spearFighters < 0) return true;
    if (trainDTO.troopsAmount.swordFighters < 0) return true;
    return false;
  }

  calculateMaterialsCostForTraining(
    troopsAmounts: TroopsAmounts,
  ): MaterialsCost {
    let materialsCost = { wood: 0, crop: 0, stones: 0 };
    materialsCost.wood =
      spearFighterMaterialsCost.wood * troopsAmounts.spearFighters +
      swordFighterMaterialsCost.wood * troopsAmounts.swordFighters +
      axeFighterMaterialsCost.wood * troopsAmounts.axeFighters +
      archerMaterialsCost.wood * troopsAmounts.archers +
      magicianMaterialsCost.wood * troopsAmounts.magicians +
      horsemenMaterialsCost.wood * troopsAmounts.horsemen +
      catapultsMaterialsCost.wood * troopsAmounts.catapults;

    materialsCost.stones =
      spearFighterMaterialsCost.stones * troopsAmounts.spearFighters +
      swordFighterMaterialsCost.stones * troopsAmounts.swordFighters +
      axeFighterMaterialsCost.stones * troopsAmounts.axeFighters +
      archerMaterialsCost.stones * troopsAmounts.archers +
      magicianMaterialsCost.stones * troopsAmounts.magicians +
      horsemenMaterialsCost.stones * troopsAmounts.horsemen +
      catapultsMaterialsCost.stones * troopsAmounts.catapults;

    materialsCost.crop =
      spearFighterMaterialsCost.crop * troopsAmounts.spearFighters +
      swordFighterMaterialsCost.crop * troopsAmounts.swordFighters +
      axeFighterMaterialsCost.crop * troopsAmounts.axeFighters +
      archerMaterialsCost.crop * troopsAmounts.archers +
      magicianMaterialsCost.crop * troopsAmounts.magicians +
      horsemenMaterialsCost.crop * troopsAmounts.horsemen +
      catapultsMaterialsCost.crop * troopsAmounts.catapults;

    return materialsCost;
  }

  doesUserHaveEnoughMaterialsForTraining(
    userMaterials: ResourcesAmounts,
    materialsCost: MaterialsCost,
  ): boolean {
    if (userMaterials.cropAmount < materialsCost.crop) return false;
    if (userMaterials.stonesAmount < materialsCost.stones) return false;
    if (userMaterials.woodAmount < materialsCost.wood) return false;
    return true;
  }

  canUserTrainAllTroopsHeTriedTo(
    arsenalLevel: number,
    troopsAmount: TroopsAmounts,
  ): boolean {
    if (
      troopsAmount.spearFighters != 0 &&
      arsenalLevel < spearFighterMinimumArsenalLevel
    )
      return false;
    if (
      troopsAmount.swordFighters != 0 &&
      arsenalLevel < swordFighterMinimumArsenalLevel
    )
      return false;
    if (
      troopsAmount.axeFighters != 0 &&
      arsenalLevel < axeFighterMinimumArsenalLevel
    )
      return false;
    if (troopsAmount.archers != 0 && arsenalLevel < archerMinimumArsenalLevel)
      return false;
    if (
      troopsAmount.magicians != 0 &&
      arsenalLevel < magicianMinimumArsenalLevel
    )
      return false;
    if (
      troopsAmount.horsemen != 0 &&
      arsenalLevel < horsemenMinimumArsenalLevel
    )
      return false;
    if (
      troopsAmount.catapults != 0 &&
      arsenalLevel < catapultsMinimumArsenalLevel
    )
      return false;
    return true;
  }

  checkIfVillageHasEnoughFreePopulation(
    freePopulation: number,
    troopsAmount: TroopsAmounts,
  ): boolean {
    let totalTroopsToTrain =
      troopsAmount.spearFighters +
      troopsAmount.swordFighters +
      troopsAmount.axeFighters +
      troopsAmount.archers +
      troopsAmount.magicians +
      troopsAmount.horsemen +
      troopsAmount.catapults;
    return totalTroopsToTrain <= freePopulation;
  }

  calculateTotalTroops(village: Village): number {
    return Village.getTotalTroops(village);
  }

  addTroopsToUser(
    userTroopsAmount: TroopsAmounts,
    troopsAmount: TroopsAmounts,
  ) {
    userTroopsAmount.spearFighters += troopsAmount.spearFighters;
    userTroopsAmount.swordFighters += troopsAmount.swordFighters;
    userTroopsAmount.axeFighters += troopsAmount.axeFighters;
    userTroopsAmount.archers += troopsAmount.archers;
    userTroopsAmount.magicians += troopsAmount.magicians;
    userTroopsAmount.horsemen += troopsAmount.horsemen;
    userTroopsAmount.catapults += troopsAmount.catapults;
  }
}

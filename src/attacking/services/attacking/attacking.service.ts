import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import {
  archerAttackingStat,
  archerDefenceStat,
  axeFighterAttackingStat,
  axeFighterDefenceStat,
  calculateDistance,
  calculateTravelTimeMs,
  catapultsAttackingStat,
  catapultsDefenceStat,
  getArmySpeed,
  horsemenAttackingStat,
  horsemenDefenceStat,
  lootingAbilityOfTroops,
  magicianAttackingStat,
  magicianDefenceStat,
  spearFighterAttackingStat,
  spearFighterDefenceStat,
  swordFighterAttackingStat,
  swordFighterDefenceStat,
  wallDefenseByLevel,
  warehouseStorageByLevel,
  getEffectiveSpeedBonus,
} from 'utils';
import { DbAccessorService } from '../../../database/services/db-accessor.service';
import { ReportsService } from '../../../reports/services/reports/reports.service';
import { ScoutingService } from '../../../scouting/scouting.service';
import { UserDTO } from '../../../user/dtos/userDTO';
import { ResourcesAmounts } from '../../../user/models/resourcesAmounts';
import { TroopsAmounts } from '../../../user/models/troopsAmounts';
import { User } from '../../../user/models/user.entity';
import { Village } from '../../../user/models/village.entity';
import { AttackDTO } from '../../dtos/attackDTO';
import { getVillageRelicIds } from '../../../relics/relic-bonus.helper';

const MOVEMENTS_COLLECTION = 'movements';

const USER_COLLECTIONS = 'users';
const BEGINNER_SHIELD_HOURS = 24;

@Injectable()
export class AttackingService {
  constructor(
    private dbAccessorService: DbAccessorService,
    private reportsService: ReportsService,
    private scoutingService: ScoutingService,
  ) {}

  private isUnderBeginnerShield(user: User): boolean {
    if (!user.joinDate) return false;
    const now = new Date();
    const joinDate = new Date(user.joinDate);
    const hoursSinceJoin =
      (now.getTime() - joinDate.getTime()) / (1000 * 60 * 60);
    return hoursSinceJoin < BEGINNER_SHIELD_HOURS;
  }

  private getBeginnerShieldRemainingHours(user: User): number {
    if (!user.joinDate) return 0;
    const now = new Date();
    const joinDate = new Date(user.joinDate);
    const hoursSinceJoin =
      (now.getTime() - joinDate.getTime()) / (1000 * 60 * 60);
    return Math.max(0, BEGINNER_SHIELD_HOURS - hoursSinceJoin);
  }

  async attack(attackDTO: AttackDTO): Promise<any> {
    if (attackDTO.attackerName == attackDTO.defenderName)
      throw new HttpException(
        'You cant attack yourself',
        HttpStatus.BAD_REQUEST,
      );

    // Validate village indexes
    if (
      attackDTO.attackerVillageIndex < 0 ||
      attackDTO.defenderVillageIndex < 0
    ) {
      throw new HttpException('Invalid village index', HttpStatus.BAD_REQUEST);
    }

    let attacker: User = (await this.dbAccessorService
      .getCollection(USER_COLLECTIONS)
      .findOne({ username: attackDTO.attackerName })) as User;
    let defender: User = (await this.dbAccessorService
      .getCollection(USER_COLLECTIONS)
      .findOne({ username: attackDTO.defenderName })) as User;
    if (!attacker || !defender)
      throw new HttpException(
        'Attacker or defender doesnt exist',
        HttpStatus.NOT_FOUND,
      );

    // Validate village indexes are in bounds
    if (attackDTO.attackerVillageIndex >= attacker.villages.length) {
      throw new HttpException(
        'Invalid attacker village index',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (attackDTO.defenderVillageIndex >= defender.villages.length) {
      throw new HttpException(
        'Invalid defender village index',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Beginner shield validation
    if (this.isUnderBeginnerShield(attacker)) {
      const remaining = this.getBeginnerShieldRemainingHours(attacker);
      throw new HttpException(
        `You are under beginner protection for ${remaining.toFixed(
          1,
        )} more hours`,
        HttpStatus.FORBIDDEN,
      );
    }
    if (this.isUnderBeginnerShield(defender)) {
      const remaining = this.getBeginnerShieldRemainingHours(defender);
      throw new HttpException(
        `This player is under beginner protection for ${remaining.toFixed(
          1,
        )} more hours`,
        HttpStatus.FORBIDDEN,
      );
    }

    // Same clan validation
    if (
      attacker.clanName &&
      defender.clanName &&
      attacker.clanName === defender.clanName
    ) {
      throw new HttpException(
        'You cannot attack players in your own clan',
        HttpStatus.BAD_REQUEST,
      );
    }

    const attackerVillage: Village =
      attacker.villages[attackDTO.attackerVillageIndex];
    const defenderVillage: Village =
      defender.villages[attackDTO.defenderVillageIndex];
    if (!attackerVillage || !defenderVillage)
      throw new HttpException(
        'Attacker or defender village doesnt exist',
        HttpStatus.NOT_FOUND,
      );

    // Check troops exist and are valid FIRST (before accessing properties)
    const spyCount = attackDTO.attackingTroops?.spies || 0;
    const hasCombatTroops = attackDTO.attackingTroops && this.hasTroopsToAttack(attackDTO.attackingTroops);

    if (spyCount > 0 && hasCombatTroops) {
      throw new HttpException(
        'Cannot send both spies and combat troops in the same action',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (spyCount > 0 && !hasCombatTroops) {
      await this.scoutingService.scoutVillageMulti(
        attackDTO.attackerName,
        attackerVillage.villageName,
        attackDTO.defenderName,
        defenderVillage.villageName,
        spyCount,
      );
      const updatedAttacker = (await this.dbAccessorService
        .getCollection(USER_COLLECTIONS)
        .findOne({ username: attackDTO.attackerName })) as User;
      return new UserDTO(updatedAttacker);
    }

    if (!attackDTO.attackingTroops || !hasCombatTroops)
      throw new HttpException(
        'You must select at least one troop to attack',
        HttpStatus.BAD_REQUEST,
      );

    if (
      !this.doesAttackerActuallyHaveThoseTroops(
        attackDTO.attackingTroops,
        attackerVillage.troops,
      )
    )
      throw new HttpException(
        'You chose more troops than you have',
        HttpStatus.BAD_REQUEST,
      );

    if (!this.doesAttackerHaveEnoughEnergy(attacker.energy))
      throw new HttpException('You have no energy.', HttpStatus.BAD_REQUEST);

    // ATOMIC: Deduct energy and troops atomically to prevent race conditions
    const troopsPath = `villages.${attackDTO.attackerVillageIndex}.troops`;
    const atomicResult = await this.dbAccessorService
      .getCollection(USER_COLLECTIONS)
      .findOneAndUpdate(
        {
          username: attackDTO.attackerName,
          energy: { $gte: 1 },
          [`${troopsPath}.spearFighters`]: {
            $gte: attackDTO.attackingTroops.spearFighters,
          },
          [`${troopsPath}.swordFighters`]: {
            $gte: attackDTO.attackingTroops.swordFighters,
          },
          [`${troopsPath}.axeFighters`]: {
            $gte: attackDTO.attackingTroops.axeFighters,
          },
          [`${troopsPath}.archers`]: {
            $gte: attackDTO.attackingTroops.archers,
          },
          [`${troopsPath}.magicians`]: {
            $gte: attackDTO.attackingTroops.magicians,
          },
          [`${troopsPath}.horsemen`]: {
            $gte: attackDTO.attackingTroops.horsemen,
          },
          [`${troopsPath}.catapults`]: {
            $gte: attackDTO.attackingTroops.catapults,
          },
        },
        {
          $inc: {
            energy: -1,
            [`${troopsPath}.spearFighters`]:
              -attackDTO.attackingTroops.spearFighters,
            [`${troopsPath}.swordFighters`]:
              -attackDTO.attackingTroops.swordFighters,
            [`${troopsPath}.axeFighters`]:
              -attackDTO.attackingTroops.axeFighters,
            [`${troopsPath}.archers`]: -attackDTO.attackingTroops.archers,
            [`${troopsPath}.magicians`]: -attackDTO.attackingTroops.magicians,
            [`${troopsPath}.horsemen`]: -attackDTO.attackingTroops.horsemen,
            [`${troopsPath}.catapults`]: -attackDTO.attackingTroops.catapults,
            [`villages.${attackDTO.attackerVillageIndex}.troopsInTransit`]:
              attackDTO.attackingTroops.spearFighters +
              attackDTO.attackingTroops.swordFighters +
              attackDTO.attackingTroops.axeFighters +
              attackDTO.attackingTroops.archers +
              attackDTO.attackingTroops.magicians +
              attackDTO.attackingTroops.horsemen +
              attackDTO.attackingTroops.catapults,
          },
        },
        { returnDocument: 'after' },
      );

    const atomicUser = atomicResult?.value ?? atomicResult;
    if (!atomicUser) {
      throw new HttpException(
        'Attack failed - not enough energy or troops (concurrent modification)',
        HttpStatus.CONFLICT,
      );
    }

    attacker = atomicUser as unknown as User;

    // Create movement entry for delayed attack
    const distance = calculateDistance(
      attackerVillage.location.x,
      attackerVillage.location.y,
      defenderVillage.location.x,
      defenderVillage.location.y,
    );
    const armySpeed = getArmySpeed(attackDTO.attackingTroops as any);
    const attackerRelicIds = await getVillageRelicIds(
      this.dbAccessorService,
      attackDTO.attackerName,
      attackerVillage.villageName,
    );
    const travelTimeMs = calculateTravelTimeMs(
      distance,
      armySpeed,
      getEffectiveSpeedBonus(attackerVillage.skills, attackerRelicIds),
    );
    const departureTime = new Date();
    const arrivalTime = new Date(departureTime.getTime() + travelTimeMs);

    const movement = {
      type: 'attack',
      senderUsername: attackDTO.attackerName,
      senderVillageName: attackerVillage.villageName,
      targetUsername: attackDTO.defenderName,
      targetVillageName: defenderVillage.villageName,
      troops: attackDTO.attackingTroops,
      departureTime,
      arrivalTime,
      status: 'in_transit',
    };

    await this.dbAccessorService
      .getCollection(MOVEMENTS_COLLECTION)
      .insertOne(movement);

    // Get fresh attacker data for response
    const updatedAttacker = (await this.dbAccessorService
      .getCollection(USER_COLLECTIONS)
      .findOne({ username: attackDTO.attackerName })) as User;
    return new UserDTO(updatedAttacker);
  }

  doesAttackerActuallyHaveThoseTroops(
    attackingTroops: TroopsAmounts,
    existingAttackerTroops: TroopsAmounts,
  ): boolean {
    if (existingAttackerTroops.spearFighters < attackingTroops.spearFighters)
      return false;
    if (existingAttackerTroops.swordFighters < attackingTroops.swordFighters)
      return false;
    if (existingAttackerTroops.axeFighters < attackingTroops.axeFighters)
      return false;
    if (existingAttackerTroops.archers < attackingTroops.archers) return false;
    if (existingAttackerTroops.magicians < attackingTroops.magicians)
      return false;
    if (existingAttackerTroops.horsemen < attackingTroops.horsemen)
      return false;
    if (existingAttackerTroops.catapults < attackingTroops.catapults)
      return false;

    return true;
  }

  doesAttackerHaveEnoughEnergy(energy: number): boolean {
    return energy > 1;
  }

  hasTroopsToAttack(troops: TroopsAmounts): boolean {
    const total =
      troops.spearFighters +
      troops.swordFighters +
      troops.axeFighters +
      troops.archers +
      troops.magicians +
      troops.horsemen +
      troops.catapults;
    return total > 0;
  }

  decreaseEnergy(attacker: User) {
    attacker.energy -= 1;
  }

  calculateAttackingPower(attackingTroops: TroopsAmounts): number {
    return (
      attackingTroops.spearFighters * spearFighterAttackingStat +
      attackingTroops.swordFighters * swordFighterAttackingStat +
      attackingTroops.axeFighters * axeFighterAttackingStat +
      attackingTroops.archers * archerAttackingStat +
      attackingTroops.magicians * magicianAttackingStat +
      attackingTroops.horsemen * horsemenAttackingStat +
      attackingTroops.catapults * catapultsAttackingStat
    );
  }

  calculateTroopsDefence(troops: TroopsAmounts): number {
    return (
      troops.spearFighters * spearFighterDefenceStat +
      troops.swordFighters * swordFighterDefenceStat +
      troops.axeFighters * axeFighterDefenceStat +
      troops.archers * archerDefenceStat +
      troops.magicians * magicianDefenceStat +
      troops.horsemen * horsemenDefenceStat +
      troops.catapults * catapultsDefenceStat
    );
  }

  calculateVillageDefence(
    defenceTroops: TroopsAmounts,
    supportTroops: TroopsAmounts,
    wallLevel: number,
  ): number {
    return (
      this.calculateTroopsDefence(defenceTroops) +
      this.calculateTroopsDefence(supportTroops) +
      wallDefenseByLevel[wallLevel]
    );
  }

  calculateKilledTroopsByRatio(
    troops: TroopsAmounts,
    ratio: number,
  ): TroopsAmounts // receives 0 < ratio <= 1. Received 0.7 -> kill 70% of those troops
  {
    if (ratio > 1 || ratio < 0) return;

    let killedTroops: TroopsAmounts = new TroopsAmounts(0, 0, 0, 0, 0, 0, 0);
    killedTroops.spearFighters = Math.floor(ratio * troops.spearFighters);
    killedTroops.swordFighters = Math.floor(ratio * troops.swordFighters);
    killedTroops.axeFighters = Math.floor(ratio * troops.axeFighters);
    killedTroops.archers = Math.floor(ratio * troops.archers);
    killedTroops.magicians = Math.floor(ratio * troops.magicians);
    killedTroops.horsemen = Math.floor(ratio * troops.horsemen);
    killedTroops.catapults = Math.floor(ratio * troops.catapults);

    return killedTroops;
  }

  updateRemainingTroopsInVillage(
    villageTroops: TroopsAmounts,
    killedTroops: TroopsAmounts,
  ) {
    villageTroops.spearFighters -= killedTroops.spearFighters;
    villageTroops.swordFighters -= killedTroops.swordFighters;
    villageTroops.axeFighters -= killedTroops.axeFighters;
    villageTroops.archers -= killedTroops.archers;
    villageTroops.magicians -= killedTroops.magicians;
    villageTroops.horsemen -= killedTroops.horsemen;
    villageTroops.catapults -= killedTroops.catapults;
  }

  addLootToAttacker(loot: ResourcesAmounts, attackerVillage: Village) {
    let maximumWoodCapacity =
      warehouseStorageByLevel[
        attackerVillage.buildingsLevels.woodWarehouseLevel
      ];
    let maximumCropCapacity =
      warehouseStorageByLevel[
        attackerVillage.buildingsLevels.cropWarehouseLevel
      ];
    let maximumStoneCapacity =
      warehouseStorageByLevel[
        attackerVillage.buildingsLevels.stoneWarehouseLevel
      ];

    attackerVillage.resourcesAmounts.woodAmount += loot.woodAmount;
    attackerVillage.resourcesAmounts.cropAmount += loot.cropAmount;
    attackerVillage.resourcesAmounts.stonesAmount += loot.stonesAmount;

    attackerVillage.resourcesAmounts.woodAmount = Math.min(
      attackerVillage.resourcesAmounts.woodAmount,
      maximumWoodCapacity,
    );
    attackerVillage.resourcesAmounts.cropAmount = Math.min(
      attackerVillage.resourcesAmounts.cropAmount,
      maximumCropCapacity,
    );
    attackerVillage.resourcesAmounts.stonesAmount = Math.min(
      attackerVillage.resourcesAmounts.stonesAmount,
      maximumStoneCapacity,
    );
  }

  decreaseLootFromDefender(loot: ResourcesAmounts, defenderVillage: Village) {
    defenderVillage.resourcesAmounts.woodAmount -= loot.woodAmount;
    defenderVillage.resourcesAmounts.cropAmount -= loot.cropAmount;
    defenderVillage.resourcesAmounts.stonesAmount -= loot.stonesAmount;
  }

  calculateLoot(
    remainingAttackerTroops: TroopsAmounts,
    defenderResources: ResourcesAmounts,
  ): ResourcesAmounts {
    let totalPossibleLootFromEachResource: number =
      this.calculateTotalPossibleLootFromEachResource(remainingAttackerTroops);
    let lootedWood: number = Math.min(
      totalPossibleLootFromEachResource,
      defenderResources.woodAmount,
    );
    let lootedStones: number = Math.min(
      totalPossibleLootFromEachResource,
      defenderResources.stonesAmount,
    );
    let lootedCrop: number = Math.min(
      totalPossibleLootFromEachResource,
      defenderResources.cropAmount,
    );
    return new ResourcesAmounts(lootedWood, lootedStones, lootedCrop);
  }

  calculateTotalPossibleLootFromEachResource(
    attackerTroops: TroopsAmounts,
  ): number {
    let totalRemainingTroops =
      attackerTroops.spearFighters +
      attackerTroops.swordFighters +
      attackerTroops.axeFighters +
      attackerTroops.archers +
      attackerTroops.magicians +
      attackerTroops.horsemen +
      attackerTroops.catapults;

    return totalRemainingTroops * lootingAbilityOfTroops;
  }
}

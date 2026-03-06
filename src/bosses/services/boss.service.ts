import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ObjectId } from 'mongodb';
import {
  archerAttackingStat,
  axeFighterAttackingStat,
  BOSS_CLAIM_DURATION_MS,
  BOSS_UNCLAIMED_DESPAWN_MS,
  bossHpRanges,
  bossMaxDamageBack,
  bossNames,
  bossRewardAmounts,
  bossSpawnWeights,
  BossTier,
  calculateDistance,
  calculateTravelTimeMs,
  catapultsAttackingStat,
  getArmySpeed,
  getDistanceDamageMultiplier,
  getSkillBonus,
  horsemenAttackingStat,
  magicianAttackingStat,
  MAX_BOSSES_ON_MAP,
  MYTHIC_BOSS_DAILY_SPAWN_CHANCE,
  RELIC_NAMES,
  SkillCategory,
  spearFighterAttackingStat,
  swordFighterAttackingStat,
  warehouseStorageByLevel,
} from 'utils';
import { AnnouncementsService } from '../../announcements/announcements.service';
import { IClan } from '../../clans/models/clan.entity';
import { DbAccessorService } from '../../database/services/db-accessor.service';
import { MessagesService } from '../../messages/services/messages.service';
import { RelicsService } from '../../relics/relics.service';
import { AttackReport } from '../../reports/models/attackReport.entity';
import { ReportsService } from '../../reports/services/reports/reports.service';
import { ResourcesAmounts } from '../../user/models/resourcesAmounts';
import { TroopsAmounts } from '../../user/models/troopsAmounts';
import { User } from '../../user/models/user.entity';
import { unlockAchievements } from '../../user/services/achievement-utils';
import { AttackBossDTO, BossDTO, RaidReportDTO } from '../dtos/bossDTO';
import { Boss, IBoss } from '../models/boss.entity';
import { RaidReport } from '../models/raidReport.entity';

const BOSSES_COLLECTION = 'bosses';
const MYTHIC_BOSS_DAMAGE_COLLECTION = 'mythicBossDamage';
const RAID_REPORTS_COLLECTION = 'raidReports';
const USERS_COLLECTION = 'users';
const CLANS_COLLECTION = 'clans';
const GRIDS_COLLECTION = 'grids';
const MOVEMENTS_COLLECTION = 'movements';
const WORLD_SIZE = 100;
const PROXIMITY_RANGE = 20; // Bosses spawn within this range of villages

@Injectable()
export class BossService {
  private readonly logger = new Logger(BossService.name);

  constructor(
    private dbAccessorService: DbAccessorService,
    private messagesService: MessagesService,
    private relicsService: RelicsService,
    private announcementsService: AnnouncementsService,
    private reportsService: ReportsService,
  ) {}

  // =====================
  // SPAWNING LOGIC
  // =====================

  // Reset weekly raid damage every Sunday at midnight
  @Cron('0 0 0 * * 0') // Sunday at 00:00:00
  async resetWeeklyRaidDamage(): Promise<void> {
    try {
      await this.dbAccessorService
        .getCollection(USERS_COLLECTION)
        .updateMany({}, { $set: { weeklyRaidDamage: 0 } });
      this.logger.log('Reset weekly raid damage for all users');
    } catch (error) {
      this.logger.error('Error resetting weekly raid damage:', error);
    }
  }

  @Cron('0 0 10 * * *') // Daily at 10:00 UTC
  async trySpawnMythicBoss(): Promise<void> {
    if (Math.random() >= MYTHIC_BOSS_DAILY_SPAWN_CHANCE) return;
    const currentMythic = await this.dbAccessorService
      .getCollection(BOSSES_COLLECTION)
      .countDocuments({ isDefeated: false, tier: BossTier.MYTHIC });
    if (currentMythic > 0) return; // only one mythic at a time
    const location = await this.findSpawnLocation();
    if (!location) return;
    await this.spawnBoss(BossTier.MYTHIC, location.x, location.y);
    this.logger.log(`Mythic boss spawned at (${location.x}, ${location.y})`);
    await this.announcementsService.createAnnouncement(
      'mythic_spawn',
      `⚡ A Mythic Boss has appeared at (${location.x}, ${location.y})!`,
      { x: location.x, y: location.y },
    );
    await this.messagesService.sendGlobalInboxMessage(
      `⚡ A Mythic Boss has appeared!`,
      `A terrifying Mythic Titan has emerged at coordinates (${location.x}, ${location.y}). Rally your clan and prepare for battle — only the mightiest will claim its relic!`,
    );
  }

  @Cron('0 */30 * * * *') // Every 30 minutes
  async trySpawnBoss(): Promise<void> {
    try {
      // Clean up expired bosses first
      await this.cleanupExpiredBosses();

      const currentBossCount = await this.dbAccessorService
        .getCollection(BOSSES_COLLECTION)
        .countDocuments({ isDefeated: false, tier: { $ne: BossTier.MYTHIC } });

      if (currentBossCount >= MAX_BOSSES_ON_MAP) {
        this.logger.log(
          `Boss cap reached (${currentBossCount}/${MAX_BOSSES_ON_MAP}), skipping spawn`,
        );
        return;
      }

      // Random chance to spawn (not every interval guarantees a spawn)
      if (Math.random() > 0.7) {
        this.logger.log('Spawn chance missed this interval');
        return;
      }

      const tier = this.selectRandomTier();
      const location = await this.findSpawnLocation();

      if (!location) {
        this.logger.warn('Could not find valid spawn location for boss');
        return;
      }

      await this.spawnBoss(tier, location.x, location.y);
      this.logger.log(`Spawned ${tier} boss at (${location.x}, ${location.y})`);
    } catch (error) {
      this.logger.error('Error in boss spawn cron:', error);
    }
  }

  private selectRandomTier(): BossTier {
    const totalWeight = Object.values(bossSpawnWeights).reduce(
      (sum, w) => sum + w,
      0,
    );
    let random = Math.random() * totalWeight;

    for (const [tier, weight] of Object.entries(bossSpawnWeights)) {
      random -= weight;
      if (random <= 0) {
        return tier as BossTier;
      }
    }
    return BossTier.COMMON;
  }

  private async findSpawnLocation(): Promise<{ x: number; y: number } | null> {
    // Find existing villages to spawn near them
    const villages = await this.dbAccessorService
      .getCollection(GRIDS_COLLECTION)
      .find({ taken: true })
      .limit(20)
      .toArray();

    if (villages.length === 0) {
      // No villages exist, spawn near center
      return { x: Math.floor(WORLD_SIZE / 2), y: Math.floor(WORLD_SIZE / 2) };
    }

    // Get existing boss locations to avoid spawning too close
    const existingBosses = (await this.dbAccessorService
      .getCollection(BOSSES_COLLECTION)
      .find({ isDefeated: false })
      .toArray()) as IBoss[];

    // Shuffle villages and try to find a valid spot near one
    const shuffledVillages = villages.sort(() => Math.random() - 0.5);

    for (const village of shuffledVillages) {
      // Generate random position near this village
      const offsetX =
        Math.floor(Math.random() * (PROXIMITY_RANGE * 2 + 1)) - PROXIMITY_RANGE;
      const offsetY =
        Math.floor(Math.random() * (PROXIMITY_RANGE * 2 + 1)) - PROXIMITY_RANGE;

      const x = Math.max(0, Math.min(WORLD_SIZE - 1, village.x + offsetX));
      const y = Math.max(0, Math.min(WORLD_SIZE - 1, village.y + offsetY));

      // Check if this cell is taken by a village
      const cellTaken = await this.dbAccessorService
        .getCollection(GRIDS_COLLECTION)
        .findOne({ x, y, taken: true });

      if (cellTaken) continue;

      // Check if another boss is already at this location
      const bossAtLocation = existingBosses.find((b) => b.x === x && b.y === y);
      if (bossAtLocation) continue;

      return { x, y };
    }

    return null;
  }

  async spawnBoss(tier: BossTier, x: number, y: number): Promise<BossDTO> {
    let hp: number;
    if (tier === BossTier.MYTHIC) {
      hp = await this.calculateMythicHp();
    } else {
      const hpRange = bossHpRanges[tier];
      hp =
        Math.floor(Math.random() * (hpRange.max - hpRange.min + 1)) +
        hpRange.min;
    }
    const name = bossNames[tier];

    const boss = new Boss(tier, name, x, y, hp);
    const doc: any = { ...boss };

    // Mythic: bind a relic at spawn (prefer unheld; if all held, pick any - winner takes it)
    if (tier === BossTier.MYTHIC) {
      const allRelics = await this.relicsService.getAllRelics();
      const available = allRelics.filter((r) => !r.holderUsername);
      const pool = available.length > 0 ? available : allRelics;
      const chosen = pool[Math.floor(Math.random() * pool.length)];
      doc.relicId = chosen.relicId;
    }

    const result = await this.dbAccessorService
      .getCollection(BOSSES_COLLECTION)
      .insertOne(doc);

    boss._id = result.insertedId;
    (boss as any).relicId = doc.relicId;
    return new BossDTO(boss);
  }

  // =====================
  // CLEANUP LOGIC
  // =====================

  private async cleanupExpiredBosses(): Promise<void> {
    const now = new Date();

    // Remove unclaimed non-mythic bosses older than 48 hours
    const unclaimedExpiry = new Date(now.getTime() - BOSS_UNCLAIMED_DESPAWN_MS);
    await this.dbAccessorService.getCollection(BOSSES_COLLECTION).deleteMany({
      isDefeated: false,
      tier: { $ne: BossTier.MYTHIC },
      claimedByClanId: { $exists: false },
      spawnedAt: { $lt: unclaimedExpiry },
    });

    // Remove claimed non-mythic bosses where claim expired (48 hours)
    const claimedExpiry = new Date(now.getTime() - BOSS_CLAIM_DURATION_MS);
    await this.dbAccessorService.getCollection(BOSSES_COLLECTION).deleteMany({
      isDefeated: false,
      tier: { $ne: BossTier.MYTHIC },
      claimedAt: { $lt: claimedExpiry },
    });

    // Mythic bosses never despawn — they must be killed
  }

  // =====================
  // QUERY METHODS
  // =====================

  async getAllActiveBosses(): Promise<BossDTO[]> {
    const bosses = (await this.dbAccessorService
      .getCollection(BOSSES_COLLECTION)
      .find({ isDefeated: false })
      .toArray()) as IBoss[];

    return bosses.map((b) => new BossDTO(b));
  }

  async getBossById(bossId: string): Promise<BossDTO | null> {
    const boss = (await this.dbAccessorService
      .getCollection(BOSSES_COLLECTION)
      .findOne({ _id: new ObjectId(bossId), isDefeated: false })) as IBoss;

    return boss ? new BossDTO(boss) : null;
  }

  async isCellOccupiedByBoss(x: number, y: number): Promise<boolean> {
    const boss = await this.dbAccessorService
      .getCollection(BOSSES_COLLECTION)
      .findOne({ x, y, isDefeated: false });

    return !!boss;
  }

  // =====================
  // ATTACK LOGIC
  // =====================

  async attackBoss(
    username: string,
    dto: AttackBossDTO,
  ): Promise<{ travelTimeMs: number }> {
    const user = (await this.dbAccessorService
      .getCollection(USERS_COLLECTION)
      .findOne({ username })) as User;

    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    if (!user.clanName) {
      throw new HttpException(
        'You must be in a clan to attack bosses',
        HttpStatus.BAD_REQUEST,
      );
    }

    const clan = (await this.dbAccessorService
      .getCollection(CLANS_COLLECTION)
      .findOne({ clanName: user.clanName })) as IClan;

    if (!clan) {
      throw new HttpException('Clan not found', HttpStatus.NOT_FOUND);
    }

    const villageIndex = user.villages.findIndex(
      (v) => v.villageName === dto.villageName,
    );
    const village = user.villages[villageIndex];
    if (!village || villageIndex < 0) {
      throw new HttpException('Village not found', HttpStatus.NOT_FOUND);
    }

    if (!dto.troops || !this.hasTroopsToAttack(dto.troops)) {
      throw new HttpException(
        'You must select at least one troop to attack',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!this.doesUserHaveTroops(dto.troops, village.troops)) {
      throw new HttpException(
        'You chose more troops than you have',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (user.energy < 1) {
      throw new HttpException('You have no energy', HttpStatus.BAD_REQUEST);
    }

    const boss = (await this.dbAccessorService
      .getCollection(BOSSES_COLLECTION)
      .findOne({ _id: new ObjectId(dto.bossId), isDefeated: false })) as IBoss;

    if (!boss) {
      throw new HttpException(
        'Boss not found or already defeated',
        HttpStatus.NOT_FOUND,
      );
    }

    if (boss.tier !== BossTier.MYTHIC) {
      if (
        boss.claimedByClanId &&
        boss.claimedByClanId !== clan._id?.toHexString()
      ) {
        throw new HttpException(
          'This boss is claimed by another clan',
          HttpStatus.FORBIDDEN,
        );
      }
      if (!boss.claimedByClanId) {
        await this.dbAccessorService.getCollection(BOSSES_COLLECTION).updateOne(
          { _id: boss._id },
          {
            $set: {
              claimedByClanId: clan._id?.toHexString(),
              claimedByClanName: clan.clanName,
              claimedAt: new Date(),
            },
          },
        );
      }
    }

    // Atomically deduct energy and troops
    const troopsPath = `villages.${villageIndex}.troops`;
    const atomicResult = await this.dbAccessorService
      .getCollection(USERS_COLLECTION)
      .findOneAndUpdate(
        {
          username,
          energy: { $gte: 1 },
          [`${troopsPath}.spearFighters`]: { $gte: dto.troops.spearFighters },
          [`${troopsPath}.swordFighters`]: { $gte: dto.troops.swordFighters },
          [`${troopsPath}.axeFighters`]: { $gte: dto.troops.axeFighters },
          [`${troopsPath}.archers`]: { $gte: dto.troops.archers },
          [`${troopsPath}.magicians`]: { $gte: dto.troops.magicians },
          [`${troopsPath}.horsemen`]: { $gte: dto.troops.horsemen },
          [`${troopsPath}.catapults`]: { $gte: dto.troops.catapults },
        },
        {
          $inc: {
            energy: -1,
            [`${troopsPath}.spearFighters`]: -dto.troops.spearFighters,
            [`${troopsPath}.swordFighters`]: -dto.troops.swordFighters,
            [`${troopsPath}.axeFighters`]: -dto.troops.axeFighters,
            [`${troopsPath}.archers`]: -dto.troops.archers,
            [`${troopsPath}.magicians`]: -dto.troops.magicians,
            [`${troopsPath}.horsemen`]: -dto.troops.horsemen,
            [`${troopsPath}.catapults`]: -dto.troops.catapults,
          },
        },
        { returnDocument: 'after' },
      );

    if (!atomicResult) {
      throw new HttpException(
        'Attack failed - not enough energy or troops',
        HttpStatus.CONFLICT,
      );
    }

    const distance = calculateDistance(
      village.location.x,
      village.location.y,
      boss.x,
      boss.y,
    );
    const armySpeed = getArmySpeed(dto.troops as any);
    const quickStepBonus = getSkillBonus(
      village.skills,
      SkillCategory.QUICK_STEP,
    );
    const travelTimeMs = calculateTravelTimeMs(
      distance,
      armySpeed,
      quickStepBonus,
    );
    const departureTime = new Date();
    const arrivalTime = new Date(departureTime.getTime() + travelTimeMs);

    const movement = {
      type: 'boss_attack',
      senderUsername: username,
      senderVillageName: village.villageName,
      targetUsername: 'boss',
      targetVillageName: boss.name,
      troops: dto.troops,
      bossId: dto.bossId,
      departureTime,
      arrivalTime,
      status: 'in_transit',
    };

    await this.dbAccessorService
      .getCollection(MOVEMENTS_COLLECTION)
      .insertOne(movement);

    return { travelTimeMs };
  }

  /**
   * Called by MovementService when a boss_attack movement arrives.
   * Resolves damage, troop losses, boss HP, rewards, and reports.
   */
  async resolveBossAttack(movement: {
    senderUsername: string;
    senderVillageName: string;
    troops: any;
    bossId: string;
  }): Promise<void> {
    const username = movement.senderUsername;
    const user = (await this.dbAccessorService
      .getCollection(USERS_COLLECTION)
      .findOne({ username })) as User;
    if (!user) return;

    const village = user.villages.find(
      (v) => v.villageName === movement.senderVillageName,
    );
    if (!village) return;

    const boss = (await this.dbAccessorService
      .getCollection(BOSSES_COLLECTION)
      .findOne({
        _id: new ObjectId(movement.bossId),
        isDefeated: false,
      })) as IBoss;

    if (!boss) {
      // Boss already defeated or expired — send message and create return movement
      await this.messagesService.sendClanNotificationMessage(
        username,
        'Boss Already Defeated',
        `Your troops arrived at the battlefield but the boss was already slain. Your troops are returning home.`,
      );
      const defeatedBoss = (await this.dbAccessorService
        .getCollection(BOSSES_COLLECTION)
        .findOne({ _id: new ObjectId(movement.bossId) })) as IBoss;
      if (defeatedBoss) {
        await this.createReturnMovement(
          username,
          movement.senderVillageName,
          movement.troops,
          village.location.x,
          village.location.y,
          defeatedBoss.x,
          defeatedBoss.y,
          village.skills,
        );
      } else {
        await this.returnTroopsToVillage(
          username,
          movement.senderVillageName,
          movement.troops,
        );
      }
      return;
    }

    const clan = user.clanName
      ? ((await this.dbAccessorService
          .getCollection(CLANS_COLLECTION)
          .findOne({ clanName: user.clanName })) as IClan)
      : null;

    const dto = movement.troops;
    const rawDamage = this.calculateAttackingPower(dto);
    const distance = this.calculateDistance(
      village.location.x,
      village.location.y,
      boss.x,
      boss.y,
    );
    const distanceMultiplier = getDistanceDamageMultiplier(distance);

    let damageMultiplier = distanceMultiplier;
    const sharperBladesBonus = getSkillBonus(
      village.skills,
      SkillCategory.SHARPER_BLADES,
    );
    if (sharperBladesBonus > 0) {
      damageMultiplier *= 1 + sharperBladesBonus;
    }

    const actualDamage = Math.floor(rawDamage * damageMultiplier);

    if (boss.tier === BossTier.MYTHIC) {
      await this.dbAccessorService
        .getCollection(MYTHIC_BOSS_DAMAGE_COLLECTION)
        .updateOne(
          { bossId: boss._id!.toHexString(), username },
          {
            $setOnInsert: {
              bossId: boss._id!.toHexString(),
              clanName: user.clanName,
              username,
              villageName: movement.senderVillageName,
            },
            $inc: { damage: actualDamage },
          },
          { upsert: true },
        );
    }

    const bossDamageBack = bossMaxDamageBack[boss.tier];
    let damageRatio = Math.min(0.25, bossDamageBack / (rawDamage + 1));

    const selfDefenseBonus = getSkillBonus(
      village.skills,
      SkillCategory.SELF_DEFENSE,
    );
    if (selfDefenseBonus > 0) {
      damageRatio = damageRatio * (1 - selfDefenseBonus);
    }

    const lostTroops = this.calculateKilledTroops(dto, damageRatio);

    const bossHpBefore = boss.currentHp;
    const bossHpAfter = Math.max(0, boss.currentHp - actualDamage);
    const bossDefeated = bossHpAfter <= 0;

    const raidReport = new RaidReport(
      username,
      village.villageName,
      user.clanName,
      boss._id!.toHexString(),
      boss.name,
      boss.tier,
      boss.x,
      boss.y,
      dto,
      lostTroops,
      rawDamage,
      distanceMultiplier,
      actualDamage,
      bossHpBefore,
      bossHpAfter,
      boss.maxHp,
      distance,
    );

    await this.dbAccessorService
      .getCollection(RAID_REPORTS_COLLECTION)
      .insertOne(raidReport);

    const emptyTroops = new TroopsAmounts(0, 0, 0, 0, 0, 0, 0);
    const emptyLoot = new ResourcesAmounts(0, 0, 0);
    const bossReport = new AttackReport(
      username,
      village.villageName,
      boss.name,
      'Boss',
      new Date(),
      bossDefeated,
      emptyLoot,
      Math.floor(rawDamage * distanceMultiplier),
      0,
      0,
      0,
      0,
      dto,
      lostTroops,
      emptyTroops,
      emptyTroops,
      emptyTroops,
      emptyTroops,
      'boss',
      boss.name,
      boss.tier,
      bossHpBefore,
      bossHpAfter,
      actualDamage,
      undefined,
    );
    if (boss.tier === BossTier.MYTHIC && (boss as any).relicId) {
      const relicDef = RELIC_NAMES.find((r) => r.id === (boss as any).relicId);
      bossReport.bossRelicId = (boss as any).relicId;
      bossReport.bossRelicName = relicDef?.name ?? (boss as any).relicId;
    }
    await this.reportsService.saveAttackReport(bossReport);

    // Return surviving troops via movement (travel back from boss location)
    const survivingTroops = new TroopsAmounts(
      Math.max(0, (dto.spearFighters || 0) - (lostTroops.spearFighters || 0)),
      Math.max(0, (dto.swordFighters || 0) - (lostTroops.swordFighters || 0)),
      Math.max(0, (dto.axeFighters || 0) - (lostTroops.axeFighters || 0)),
      Math.max(0, (dto.archers || 0) - (lostTroops.archers || 0)),
      Math.max(0, (dto.magicians || 0) - (lostTroops.magicians || 0)),
      Math.max(0, (dto.horsemen || 0) - (lostTroops.horsemen || 0)),
      Math.max(0, (dto.catapults || 0) - (lostTroops.catapults || 0)),
    );
    await this.createReturnMovement(
      username,
      movement.senderVillageName,
      survivingTroops,
      village.location.x,
      village.location.y,
      boss.x,
      boss.y,
      village.skills,
    );

    // Update weekly/total stats
    await this.dbAccessorService.getCollection(USERS_COLLECTION).updateOne(
      { username },
      {
        $inc: {
          weeklyRaidDamage: actualDamage,
          'weeklyStats.bossDamage': actualDamage,
          'totalStats.lifetimeBossDamage': actualDamage,
        },
      },
    );

    const updatedUser = (await this.dbAccessorService
      .getCollection(USERS_COLLECTION)
      .findOne({ username })) as unknown as User;
    if (
      updatedUser &&
      unlockAchievements(updatedUser, [
        'weeklyStats.bossDamage',
        'totalStats.lifetimeBossDamage',
      ])
    ) {
      await this.dbAccessorService.getCollection(USERS_COLLECTION).updateOne(
        { username },
        {
          $set: {
            unlockedAchievements: (updatedUser as any).unlockedAchievements,
          },
        },
      );
    }

    if (bossDefeated) {
      const updateResult = await this.dbAccessorService
        .getCollection(BOSSES_COLLECTION)
        .updateOne(
          { _id: boss._id, isDefeated: false },
          { $set: { currentHp: 0, isDefeated: true, defeatedAt: new Date() } },
        );

      if (updateResult.modifiedCount > 0) {
        if (boss.tier === BossTier.MYTHIC) {
          await this.awardMythicRelicToTopClan(boss);
          return;
        }

        if (clan) {
          await this.dbAccessorService
            .getCollection(CLANS_COLLECTION)
            .updateOne(
              { clanName: clan.clanName },
              { $inc: { totalBossesKilled: 1 } },
            );

          await this.distributeRewards(clan, boss.tier);
        }
      }
    } else {
      await this.dbAccessorService
        .getCollection(BOSSES_COLLECTION)
        .updateOne(
          { _id: boss._id, isDefeated: false },
          { $set: { currentHp: bossHpAfter } },
        );
    }
  }

  /**
   * Awards the mythic boss relic to the clan leader's first village of the clan
   * that dealt the most total damage.
   */
  private async awardMythicRelicToTopClan(boss: IBoss): Promise<void> {
    const relicId = (boss as any).relicId;
    if (!relicId) return;

    const damageDocs = (await this.dbAccessorService
      .getCollection(MYTHIC_BOSS_DAMAGE_COLLECTION)
      .find({ bossId: boss._id!.toHexString() })
      .toArray()) as unknown as {
      clanName: string;
      username: string;
      villageName: string;
      damage: number;
    }[];

    if (damageDocs.length === 0) return;

    const byClan: Record<string, number> = {};
    for (const d of damageDocs) {
      byClan[d.clanName] = (byClan[d.clanName] ?? 0) + d.damage;
    }
    const topClanEntry = Object.entries(byClan).sort((a, b) => b[1] - a[1])[0];
    if (!topClanEntry) return;

    const [topClanName] = topClanEntry;
    const clan = (await this.dbAccessorService
      .getCollection(CLANS_COLLECTION)
      .findOne({ clanName: topClanName })) as IClan;
    if (!clan) return;

    const leader = (await this.dbAccessorService
      .getCollection(USERS_COLLECTION)
      .findOne({ username: clan.leaderUsername })) as User;
    if (!leader || !leader.villages || leader.villages.length === 0) return;

    const firstVillage = leader.villages[0];
    const relicName = await this.relicsService.assignRelicToClan(
      relicId,
      topClanName,
      clan.leaderUsername,
      firstVillage.villageName,
    );

    await this.messagesService.sendGlobalInboxMessage(
      `The Mythic Beast has fallen!`,
      `The world trembles — Clan ${topClanName} has slain the ${boss.name} and claimed the ${relicName}. Their power grows beyond measure.`,
    );
  }

  private async returnTroopsToVillage(
    username: string,
    villageName: string,
    troops: any,
  ): Promise<void> {
    const user = (await this.dbAccessorService
      .getCollection(USERS_COLLECTION)
      .findOne({ username })) as User;
    if (!user) return;
    const village = user.villages.find((v) => v.villageName === villageName);
    if (!village) return;

    village.troops.spearFighters += troops.spearFighters || 0;
    village.troops.swordFighters += troops.swordFighters || 0;
    village.troops.axeFighters += troops.axeFighters || 0;
    village.troops.archers += troops.archers || 0;
    village.troops.magicians += troops.magicians || 0;
    village.troops.horsemen += troops.horsemen || 0;
    village.troops.catapults += troops.catapults || 0;

    await this.dbAccessorService
      .getCollection(USERS_COLLECTION)
      .updateOne({ username }, { $set: { villages: user.villages } });
  }

  private async createReturnMovement(
    username: string,
    villageName: string,
    troops: TroopsAmounts,
    villageX: number,
    villageY: number,
    bossX: number,
    bossY: number,
    skills: any,
  ): Promise<void> {
    const totalSurviving =
      troops.spearFighters +
      troops.swordFighters +
      troops.axeFighters +
      troops.archers +
      troops.magicians +
      troops.horsemen +
      troops.catapults;
    if (totalSurviving <= 0) return;

    const distance = calculateDistance(villageX, villageY, bossX, bossY);
    const armySpeed = getArmySpeed(troops as any);
    const quickStepBonus = getSkillBonus(skills, SkillCategory.QUICK_STEP);
    const travelTimeMs = calculateTravelTimeMs(
      distance,
      armySpeed,
      quickStepBonus,
    );
    const departureTime = new Date();
    const arrivalTime = new Date(departureTime.getTime() + travelTimeMs);

    await this.dbAccessorService.getCollection(MOVEMENTS_COLLECTION).insertOne({
      type: 'return',
      senderUsername: username,
      senderVillageName: villageName,
      targetUsername: username,
      targetVillageName: villageName,
      troops,
      departureTime,
      arrivalTime,
      status: 'in_transit',
    });
  }

  // =====================
  // REWARDS
  // =====================

  private async distributeRewards(
    clan: IClan,
    tier: BossTier,
  ): Promise<{ wood: number; stone: number; crop: number }> {
    const rewardAmount = bossRewardAmounts[tier];
    const bossName = bossNames[tier];
    // Generate a unique reward ID for this boss defeat - shared across all clan members
    const rewardId = new ObjectId().toHexString();

    // Add pending rewards to each clan member instead of direct deposit
    for (const memberUsername of clan.members) {
      const member = (await this.dbAccessorService
        .getCollection(USERS_COLLECTION)
        .findOne({ username: memberUsername })) as User;

      if (!member) continue;

      // Initialize pendingBossRewards if not exists
      if (!member.pendingBossRewards) {
        member.pendingBossRewards = [];
      }

      // Add pending reward with unique ID
      member.pendingBossRewards.push({
        rewardId: rewardId,
        bossName: bossName,
        defeatedAt: new Date(),
        rewards: {
          wood: rewardAmount,
          stone: rewardAmount,
          crop: rewardAmount,
        },
      });

      await this.dbAccessorService
        .getCollection(USERS_COLLECTION)
        .updateOne(
          { username: memberUsername },
          { $set: { pendingBossRewards: member.pendingBossRewards } },
        );

      // Send message to clan member with claim info (include rewardId)
      await this.messagesService.sendBossDefeatedMessage(
        memberUsername,
        bossName,
        rewardAmount,
        rewardId,
      );
    }

    return { wood: rewardAmount, stone: rewardAmount, crop: rewardAmount };
  }

  // Claim boss rewards for a user
  async claimBossReward(
    username: string,
    rewardId: string,
  ): Promise<{
    success: boolean;
    rewards?: { wood: number; stone: number; crop: number };
  }> {
    // Atomically pull the reward by rewardId — prevents double-claim
    const result = await this.dbAccessorService
      .getCollection(USERS_COLLECTION)
      .findOneAndUpdate(
        { username, 'pendingBossRewards.rewardId': rewardId },
        { $pull: { pendingBossRewards: { rewardId } } } as any,
        { returnDocument: 'before' },
      ) as any;

    if (!result) {
      throw new HttpException('Reward not found or already claimed', HttpStatus.NOT_FOUND);
    }

    const user = result as User;
    const reward = user.pendingBossRewards?.find((r) => r.rewardId === rewardId);
    if (!reward) {
      throw new HttpException('Reward not found or already claimed', HttpStatus.NOT_FOUND);
    }

    const village = user.villages[0];
    if (!village) {
      throw new HttpException('Village not found', HttpStatus.NOT_FOUND);
    }

    const maxWood = warehouseStorageByLevel[village.buildingsLevels.woodWarehouseLevel];
    const maxStone = warehouseStorageByLevel[village.buildingsLevels.stoneWarehouseLevel];
    const maxCrop = warehouseStorageByLevel[village.buildingsLevels.cropWarehouseLevel];

    // Reject if all warehouses are completely full
    if (
      village.resourcesAmounts.woodAmount >= maxWood &&
      village.resourcesAmounts.stonesAmount >= maxStone &&
      village.resourcesAmounts.cropAmount >= maxCrop
    ) {
      // Put the reward back since we already pulled it
      await this.dbAccessorService
        .getCollection(USERS_COLLECTION)
        .updateOne(
          { username },
          { $push: { pendingBossRewards: reward } } as any,
        );
      throw new HttpException('All warehouses are full. Free up space before claiming.', HttpStatus.BAD_REQUEST);
    }

    // Deposit resources (capped by warehouse capacity)
    await this.dbAccessorService.getCollection(USERS_COLLECTION).updateOne(
      { username },
      {
        $set: {
          'villages.0.resourcesAmounts.woodAmount': Math.min(
            village.resourcesAmounts.woodAmount + reward.rewards.wood,
            maxWood,
          ),
          'villages.0.resourcesAmounts.stonesAmount': Math.min(
            village.resourcesAmounts.stonesAmount + reward.rewards.stone,
            maxStone,
          ),
          'villages.0.resourcesAmounts.cropAmount': Math.min(
            village.resourcesAmounts.cropAmount + reward.rewards.crop,
            maxCrop,
          ),
        },
      },
    );

    return { success: true, rewards: reward.rewards };
  }

  // Get pending rewards for a user
  async getPendingRewards(username: string): Promise<
    {
      bossName: string;
      defeatedAt: Date;
      rewards: { wood: number; stone: number; crop: number };
    }[]
  > {
    const user = (await this.dbAccessorService
      .getCollection(USERS_COLLECTION)
      .findOne({ username })) as User;

    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    return user.pendingBossRewards || [];
  }

  // =====================
  // RAID REPORTS
  // =====================

  async getRaidReports(
    username: string,
    page: number,
  ): Promise<RaidReportDTO[]> {
    const skip = 10 * (page - 1);
    const reports = (await this.dbAccessorService
      .getCollection(RAID_REPORTS_COLLECTION)
      .find({ attackerUsername: username })
      .sort({ date: -1 })
      .skip(skip)
      .limit(10)
      .toArray()) as RaidReport[];

    return reports.map((r) => new RaidReportDTO(r));
  }

  async getRaidReportPageCount(username: string): Promise<number> {
    const count = await this.dbAccessorService
      .getCollection(RAID_REPORTS_COLLECTION)
      .countDocuments({ attackerUsername: username });

    return Math.ceil(count / 10) || 1;
  }

  async markRaidReportAsRead(
    reportId: string,
    username: string,
  ): Promise<void> {
    await this.dbAccessorService
      .getCollection(RAID_REPORTS_COLLECTION)
      .updateOne(
        { _id: new ObjectId(reportId), attackerUsername: username },
        { $set: { read: true } },
      );
  }

  async getUnreadRaidReportCount(username: string): Promise<number> {
    return await this.dbAccessorService
      .getCollection(RAID_REPORTS_COLLECTION)
      .countDocuments({ attackerUsername: username, read: false });
  }

  // =====================
  // BOSS DAMAGE LEADERBOARD
  // =====================

  async getBossDamageLeaderboard(bossId: string): Promise<
    {
      clanName: string;
      totalDamage: number;
      players: { username: string; damage: number }[];
    }[]
  > {
    const raidReports = (await this.dbAccessorService
      .getCollection(RAID_REPORTS_COLLECTION)
      .find({ bossId })
      .toArray()) as RaidReport[];

    const byClan: Record<
      string,
      { totalDamage: number; players: Record<string, number> }
    > = {};
    for (const r of raidReports) {
      const clan = r.attackerClanName || 'No Clan';
      if (!byClan[clan]) {
        byClan[clan] = { totalDamage: 0, players: {} };
      }
      byClan[clan].totalDamage += r.actualDamage;
      byClan[clan].players[r.attackerUsername] =
        (byClan[clan].players[r.attackerUsername] || 0) + r.actualDamage;
    }

    return Object.entries(byClan)
      .map(([clanName, data]) => ({
        clanName,
        totalDamage: data.totalDamage,
        players: Object.entries(data.players)
          .map(([username, damage]) => ({ username, damage }))
          .sort((a, b) => b.damage - a.damage),
      }))
      .sort((a, b) => b.totalDamage - a.totalDamage);
  }

  // =====================
  // HELPER METHODS
  // =====================

  /**
   * Mythic HP = 2 * playerCount * legendaryAvgHp, clamped between 10x and 100x legendary.
   */
  private async calculateMythicHp(): Promise<number> {
    const playerCount = await this.dbAccessorService
      .getCollection(USERS_COLLECTION)
      .countDocuments({});
    const legendaryRange = bossHpRanges[BossTier.LEGENDARY];
    const legendaryAvg = (legendaryRange.min + legendaryRange.max) / 2;
    const multiplier = Math.max(10, Math.min(100, 2 * playerCount));
    return Math.floor(legendaryAvg * multiplier);
  }

  private calculateAttackingPower(troops: TroopsAmounts): number {
    return (
      (troops.spearFighters || 0) * spearFighterAttackingStat +
      (troops.swordFighters || 0) * swordFighterAttackingStat +
      (troops.axeFighters || 0) * axeFighterAttackingStat +
      (troops.archers || 0) * archerAttackingStat +
      (troops.magicians || 0) * magicianAttackingStat +
      (troops.horsemen || 0) * horsemenAttackingStat +
      (troops.catapults || 0) * catapultsAttackingStat
    );
  }

  private calculateDistance(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ): number {
    return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
  }

  private hasTroopsToAttack(troops: TroopsAmounts): boolean {
    const total =
      (troops.spearFighters || 0) +
      (troops.swordFighters || 0) +
      (troops.axeFighters || 0) +
      (troops.archers || 0) +
      (troops.magicians || 0) +
      (troops.horsemen || 0) +
      (troops.catapults || 0);
    return total > 0;
  }

  private doesUserHaveTroops(
    attacking: TroopsAmounts,
    available: TroopsAmounts,
  ): boolean {
    return (
      (attacking.spearFighters || 0) <= (available.spearFighters || 0) &&
      (attacking.swordFighters || 0) <= (available.swordFighters || 0) &&
      (attacking.axeFighters || 0) <= (available.axeFighters || 0) &&
      (attacking.archers || 0) <= (available.archers || 0) &&
      (attacking.magicians || 0) <= (available.magicians || 0) &&
      (attacking.horsemen || 0) <= (available.horsemen || 0) &&
      (attacking.catapults || 0) <= (available.catapults || 0)
    );
  }

  private calculateKilledTroops(
    troops: TroopsAmounts,
    ratio: number,
  ): TroopsAmounts {
    return new TroopsAmounts(
      Math.floor((troops.spearFighters || 0) * ratio),
      Math.floor((troops.swordFighters || 0) * ratio),
      Math.floor((troops.axeFighters || 0) * ratio),
      Math.floor((troops.archers || 0) * ratio),
      Math.floor((troops.magicians || 0) * ratio),
      Math.floor((troops.horsemen || 0) * ratio),
      Math.floor((troops.catapults || 0) * ratio),
    );
  }

  private updateRemainingTroops(
    village: TroopsAmounts,
    lost: TroopsAmounts,
  ): void {
    village.spearFighters -= lost.spearFighters || 0;
    village.swordFighters -= lost.swordFighters || 0;
    village.axeFighters -= lost.axeFighters || 0;
    village.archers -= lost.archers || 0;
    village.magicians -= lost.magicians || 0;
    village.horsemen -= lost.horsemen || 0;
    village.catapults -= lost.catapults || 0;
  }
}

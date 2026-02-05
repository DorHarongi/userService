import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ObjectId } from 'mongodb';
import { DbAccessorService } from '../../database/services/db-accessor.service';
import { MessagesService } from '../../messages/services/messages.service';
import { Boss, IBoss } from '../models/boss.entity';
import { RaidReport } from '../models/raidReport.entity';
import { BossDTO, RaidReportDTO, AttackBossDTO, BossAttackResultDTO } from '../dtos/bossDTO';
import { TroopsAmounts } from '../../user/models/troopsAmounts';
import { User } from '../../user/models/user.entity';
import { Village } from '../../user/models/village.entity';
import { IClan } from '../../clans/models/clan.entity';
import {
    BossTier,
    bossHpRanges,
    bossNames,
    bossSpawnWeights,
    bossRewardAmounts,
    bossMaxDamageBack,
    getDistanceDamageMultiplier,
    MAX_BOSSES_ON_MAP,
    BOSS_CLAIM_DURATION_MS,
    BOSS_UNCLAIMED_DESPAWN_MS,
    warehouseStorageByLevel,
    spearFighterAttackingStat,
    swordFighterAttackingStat,
    axeFighterAttackingStat,
    archerAttackingStat,
    magicianAttackingStat,
    horsemenAttackingStat,
    catapultsAttackingStat,
    VillageTrait,
    getTraitBonus
} from 'utils';

const BOSSES_COLLECTION = 'bosses';
const RAID_REPORTS_COLLECTION = 'raidReports';
const USERS_COLLECTION = 'users';
const CLANS_COLLECTION = 'clans';
const GRIDS_COLLECTION = 'grids';
const WORLD_SIZE = 100;
const PROXIMITY_RANGE = 20; // Bosses spawn within this range of villages

@Injectable()
export class BossService {
    private readonly logger = new Logger(BossService.name);

    constructor(
        private dbAccessorService: DbAccessorService,
        private messagesService: MessagesService
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

    @Cron('0 */30 * * * *') // Every 30 minutes
    async trySpawnBoss(): Promise<void> {
        try {
            // Clean up expired bosses first
            await this.cleanupExpiredBosses();

            const currentBossCount = await this.dbAccessorService
                .getCollection(BOSSES_COLLECTION)
                .countDocuments({ isDefeated: false });

            if (currentBossCount >= MAX_BOSSES_ON_MAP) {
                this.logger.log(`Boss cap reached (${currentBossCount}/${MAX_BOSSES_ON_MAP}), skipping spawn`);
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
        const totalWeight = Object.values(bossSpawnWeights).reduce((sum, w) => sum + w, 0);
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
        const existingBosses = await this.dbAccessorService
            .getCollection(BOSSES_COLLECTION)
            .find({ isDefeated: false })
            .toArray() as IBoss[];

        // Shuffle villages and try to find a valid spot near one
        const shuffledVillages = villages.sort(() => Math.random() - 0.5);
        
        for (const village of shuffledVillages) {
            // Generate random position near this village
            const offsetX = Math.floor(Math.random() * (PROXIMITY_RANGE * 2 + 1)) - PROXIMITY_RANGE;
            const offsetY = Math.floor(Math.random() * (PROXIMITY_RANGE * 2 + 1)) - PROXIMITY_RANGE;
            
            const x = Math.max(0, Math.min(WORLD_SIZE - 1, village.x + offsetX));
            const y = Math.max(0, Math.min(WORLD_SIZE - 1, village.y + offsetY));

            // Check if this cell is taken by a village
            const cellTaken = await this.dbAccessorService
                .getCollection(GRIDS_COLLECTION)
                .findOne({ x, y, taken: true });
            
            if (cellTaken) continue;

            // Check if another boss is already at this location
            const bossAtLocation = existingBosses.find(b => b.x === x && b.y === y);
            if (bossAtLocation) continue;

            return { x, y };
        }

        return null;
    }

    async spawnBoss(tier: BossTier, x: number, y: number): Promise<BossDTO> {
        const hpRange = bossHpRanges[tier];
        const hp = Math.floor(Math.random() * (hpRange.max - hpRange.min + 1)) + hpRange.min;
        const name = bossNames[tier];

        const boss = new Boss(tier, name, x, y, hp);
        const result = await this.dbAccessorService
            .getCollection(BOSSES_COLLECTION)
            .insertOne(boss);
        
        boss._id = result.insertedId;
        return new BossDTO(boss);
    }

    // =====================
    // CLEANUP LOGIC
    // =====================

    private async cleanupExpiredBosses(): Promise<void> {
        const now = new Date();

        // Remove unclaimed bosses older than 24 hours
        const unclaimedExpiry = new Date(now.getTime() - BOSS_UNCLAIMED_DESPAWN_MS);
        await this.dbAccessorService
            .getCollection(BOSSES_COLLECTION)
            .deleteMany({
                isDefeated: false,
                claimedByClanId: { $exists: false },
                spawnedAt: { $lt: unclaimedExpiry }
            });

        // Remove claimed bosses where claim expired (48 hours)
        const claimedExpiry = new Date(now.getTime() - BOSS_CLAIM_DURATION_MS);
        await this.dbAccessorService
            .getCollection(BOSSES_COLLECTION)
            .deleteMany({
                isDefeated: false,
                claimedAt: { $lt: claimedExpiry }
            });
    }

    // =====================
    // QUERY METHODS
    // =====================

    async getAllActiveBosses(): Promise<BossDTO[]> {
        const bosses = await this.dbAccessorService
            .getCollection(BOSSES_COLLECTION)
            .find({ isDefeated: false })
            .toArray() as IBoss[];
        
        return bosses.map(b => new BossDTO(b));
    }

    async getBossById(bossId: string): Promise<BossDTO | null> {
        const boss = await this.dbAccessorService
            .getCollection(BOSSES_COLLECTION)
            .findOne({ _id: new ObjectId(bossId), isDefeated: false }) as IBoss;
        
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

    async attackBoss(username: string, dto: AttackBossDTO): Promise<BossAttackResultDTO> {
        // Get user and validate
        const user = await this.dbAccessorService
            .getCollection(USERS_COLLECTION)
            .findOne({ username }) as User;
        
        if (!user) {
            throw new HttpException('User not found', HttpStatus.NOT_FOUND);
        }

        if (!user.clanName) {
            throw new HttpException('You must be in a clan to attack bosses', HttpStatus.BAD_REQUEST);
        }

        // Get clan
        const clan = await this.dbAccessorService
            .getCollection(CLANS_COLLECTION)
            .findOne({ clanName: user.clanName }) as IClan;
        
        if (!clan) {
            throw new HttpException('Clan not found', HttpStatus.NOT_FOUND);
        }

        // Get village
        const village = user.villages.find(v => v.villageName === dto.villageName);
        if (!village) {
            throw new HttpException('Village not found', HttpStatus.NOT_FOUND);
        }

        // Validate troops
        if (!dto.troops || !this.hasTroopsToAttack(dto.troops)) {
            throw new HttpException('You must select at least one troop to attack', HttpStatus.BAD_REQUEST);
        }

        if (!this.doesUserHaveTroops(dto.troops, village.troops)) {
            throw new HttpException('You chose more troops than you have', HttpStatus.BAD_REQUEST);
        }

        if (user.energy < 1) {
            throw new HttpException('You have no energy', HttpStatus.BAD_REQUEST);
        }

        // Get boss
        const boss = await this.dbAccessorService
            .getCollection(BOSSES_COLLECTION)
            .findOne({ _id: new ObjectId(dto.bossId), isDefeated: false }) as IBoss;
        
        if (!boss) {
            throw new HttpException('Boss not found or already defeated', HttpStatus.NOT_FOUND);
        }

        // Check if boss is claimed by another clan
        if (boss.claimedByClanId && boss.claimedByClanId !== clan._id?.toHexString()) {
            throw new HttpException('This boss is claimed by another clan', HttpStatus.FORBIDDEN);
        }

        // Claim boss for this clan if not already claimed
        if (!boss.claimedByClanId) {
            await this.dbAccessorService
                .getCollection(BOSSES_COLLECTION)
                .updateOne(
                    { _id: boss._id },
                    { 
                        $set: { 
                            claimedByClanId: clan._id?.toHexString(),
                            claimedByClanName: clan.clanName,
                            claimedAt: new Date()
                        }
                    }
                );
            boss.claimedByClanId = clan._id?.toHexString();
            boss.claimedByClanName = clan.clanName;
            boss.claimedAt = new Date();
        }

        // Calculate damage
        const rawDamage = this.calculateAttackingPower(dto.troops);
        const distance = this.calculateDistance(village.location.x, village.location.y, boss.x, boss.y);
        const distanceMultiplier = getDistanceDamageMultiplier(distance);
        
        // Apply Warlord trait bonus to attack damage
        let damageMultiplier = distanceMultiplier;
        const villageTrait = village.trait;
        const academyLevel = village.buildingsLevels?.academyLevel || 1;
        if (villageTrait === VillageTrait.WARLORD) {
            const warlordBonus = getTraitBonus(academyLevel);
            damageMultiplier *= (1 + warlordBonus);
        }
        
        const actualDamage = Math.floor(rawDamage * damageMultiplier);

        // Calculate troop losses (boss fights back)
        // Flat damage cap per tier - predictable losses regardless of boss HP
        const bossDamageBack = bossMaxDamageBack[boss.tier];
        let damageRatio = Math.min(0.25, bossDamageBack / (rawDamage + 1)); // Max 25% loss
        
        // Apply Guardian trait bonus to reduce troop losses
        if (villageTrait === VillageTrait.GUARDIAN) {
            const guardianBonus = getTraitBonus(academyLevel);
            damageRatio = damageRatio * (1 - guardianBonus); // Reduce troop losses
        }
        
        const lostTroops = this.calculateKilledTroops(dto.troops, damageRatio);

        // Update boss HP
        const bossHpBefore = boss.currentHp;
        const bossHpAfter = Math.max(0, boss.currentHp - actualDamage);
        const bossDefeated = bossHpAfter <= 0;

        // Create raid report
        const raidReport = new RaidReport(
            username,
            village.villageName,
            user.clanName,
            boss._id!.toHexString(),
            boss.name,
            boss.tier,
            boss.x,
            boss.y,
            dto.troops,
            lostTroops,
            rawDamage,
            distanceMultiplier,
            actualDamage,
            bossHpBefore,
            bossHpAfter,
            boss.maxHp,
            distance
        );

        const reportResult = await this.dbAccessorService
            .getCollection(RAID_REPORTS_COLLECTION)
            .insertOne(raidReport);
        raidReport._id = reportResult.insertedId;

        // Update user (energy, troops, and weekly raid damage)
        this.updateRemainingTroops(village.troops, lostTroops);
        user.energy -= 1;
        user.weeklyRaidDamage = (user.weeklyRaidDamage || 0) + actualDamage;
        
        await this.dbAccessorService
            .getCollection(USERS_COLLECTION)
            .updateOne({ username }, { $set: user });

        // Update boss - use atomic update with isDefeated: false condition to prevent race conditions
        if (bossDefeated) {
            // Try to mark boss as defeated - only succeeds if not already defeated
            const updateResult = await this.dbAccessorService
                .getCollection(BOSSES_COLLECTION)
                .updateOne(
                    { _id: boss._id, isDefeated: false },
                    { $set: { currentHp: 0, isDefeated: true, defeatedAt: new Date() } }
                );

            // If we actually defeated the boss (not already defeated by another request)
            if (updateResult.modifiedCount > 0) {
                // Increment clan's total bosses killed
                await this.dbAccessorService
                    .getCollection(CLANS_COLLECTION)
                    .updateOne(
                        { clanName: clan.clanName },
                        { $inc: { totalBossesKilled: 1 } }
                    );

                // Distribute rewards to all clan members
                const rewards = await this.distributeRewards(clan, boss.tier);
                
                return {
                    report: new RaidReportDTO(raidReport),
                    bossDefeated: true,
                    rewards
                };
            } else {
                // Boss was already defeated by another concurrent attack
                // Return result without rewards (they were already distributed)
                return {
                    report: new RaidReportDTO(raidReport),
                    bossDefeated: true,
                    // No rewards - already distributed to clan by the winning attack
                };
            }
        } else {
            // Only update HP if boss is not already defeated
            await this.dbAccessorService
                .getCollection(BOSSES_COLLECTION)
                .updateOne(
                    { _id: boss._id, isDefeated: false },
                    { $set: { currentHp: bossHpAfter } }
                );

            return {
                report: new RaidReportDTO(raidReport),
                bossDefeated: false
            };
        }
    }

    // =====================
    // REWARDS
    // =====================

    private async distributeRewards(clan: IClan, tier: BossTier): Promise<{ wood: number; stone: number; crop: number }> {
        const rewardAmount = bossRewardAmounts[tier];
        const bossName = bossNames[tier];
        // Generate a unique reward ID for this boss defeat - shared across all clan members
        const rewardId = new ObjectId().toHexString();

        // Add pending rewards to each clan member instead of direct deposit
        for (const memberUsername of clan.members) {
            const member = await this.dbAccessorService
                .getCollection(USERS_COLLECTION)
                .findOne({ username: memberUsername }) as User;
            
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
                    crop: rewardAmount
                }
            });

            await this.dbAccessorService
                .getCollection(USERS_COLLECTION)
                .updateOne({ username: memberUsername }, { $set: { pendingBossRewards: member.pendingBossRewards } });

            // Send message to clan member with claim info (include rewardId)
            await this.messagesService.sendBossDefeatedMessage(
                memberUsername,
                bossName,
                rewardAmount,
                rewardId
            );
        }

        return { wood: rewardAmount, stone: rewardAmount, crop: rewardAmount };
    }

    // Claim boss rewards for a user
    async claimBossReward(username: string, rewardIndex: number): Promise<{ success: boolean; rewards?: { wood: number; stone: number; crop: number } }> {
        const user = await this.dbAccessorService
            .getCollection(USERS_COLLECTION)
            .findOne({ username }) as User;

        if (!user) {
            throw new HttpException('User not found', HttpStatus.NOT_FOUND);
        }

        if (!user.pendingBossRewards || rewardIndex < 0 || rewardIndex >= user.pendingBossRewards.length) {
            throw new HttpException('Reward not found', HttpStatus.NOT_FOUND);
        }

        const reward = user.pendingBossRewards[rewardIndex];
        const village = user.villages[0];
        
        if (!village) {
            throw new HttpException('Village not found', HttpStatus.NOT_FOUND);
        }

        // Get warehouse capacities
        const maxWood = warehouseStorageByLevel[village.buildingsLevels.woodWarehouseLevel];
        const maxStone = warehouseStorageByLevel[village.buildingsLevels.stoneWarehouseLevel];
        const maxCrop = warehouseStorageByLevel[village.buildingsLevels.cropWarehouseLevel];

        // Add rewards (capped by warehouse capacity)
        village.resourcesAmounts.woodAmount = Math.min(
            village.resourcesAmounts.woodAmount + reward.rewards.wood,
            maxWood
        );
        village.resourcesAmounts.stonesAmount = Math.min(
            village.resourcesAmounts.stonesAmount + reward.rewards.stone,
            maxStone
        );
        village.resourcesAmounts.cropAmount = Math.min(
            village.resourcesAmounts.cropAmount + reward.rewards.crop,
            maxCrop
        );

        // Remove the claimed reward
        user.pendingBossRewards.splice(rewardIndex, 1);

        await this.dbAccessorService
            .getCollection(USERS_COLLECTION)
            .updateOne({ username }, { $set: user });

        return { success: true, rewards: reward.rewards };
    }

    // Get pending rewards for a user
    async getPendingRewards(username: string): Promise<{ bossName: string; defeatedAt: Date; rewards: { wood: number; stone: number; crop: number } }[]> {
        const user = await this.dbAccessorService
            .getCollection(USERS_COLLECTION)
            .findOne({ username }) as User;

        if (!user) {
            throw new HttpException('User not found', HttpStatus.NOT_FOUND);
        }

        return user.pendingBossRewards || [];
    }

    // =====================
    // RAID REPORTS
    // =====================

    async getRaidReports(username: string, page: number): Promise<RaidReportDTO[]> {
        const skip = 10 * (page - 1);
        const reports = await this.dbAccessorService
            .getCollection(RAID_REPORTS_COLLECTION)
            .find({ attackerUsername: username })
            .sort({ date: -1 })
            .skip(skip)
            .limit(10)
            .toArray() as RaidReport[];

        return reports.map(r => new RaidReportDTO(r));
    }

    async getRaidReportPageCount(username: string): Promise<number> {
        const count = await this.dbAccessorService
            .getCollection(RAID_REPORTS_COLLECTION)
            .countDocuments({ attackerUsername: username });
        
        return Math.ceil(count / 10) || 1;
    }

    async markRaidReportAsRead(reportId: string, username: string): Promise<void> {
        await this.dbAccessorService
            .getCollection(RAID_REPORTS_COLLECTION)
            .updateOne(
                { _id: new ObjectId(reportId), attackerUsername: username },
                { $set: { read: true } }
            );
    }

    async getUnreadRaidReportCount(username: string): Promise<number> {
        return await this.dbAccessorService
            .getCollection(RAID_REPORTS_COLLECTION)
            .countDocuments({ attackerUsername: username, read: false });
    }

    // =====================
    // HELPER METHODS
    // =====================

    private calculateAttackingPower(troops: TroopsAmounts): number {
        return (troops.spearFighters || 0) * spearFighterAttackingStat +
            (troops.swordFighters || 0) * swordFighterAttackingStat +
            (troops.axeFighters || 0) * axeFighterAttackingStat +
            (troops.archers || 0) * archerAttackingStat +
            (troops.magicians || 0) * magicianAttackingStat +
            (troops.horsemen || 0) * horsemenAttackingStat +
            (troops.catapults || 0) * catapultsAttackingStat;
    }

    private calculateDistance(x1: number, y1: number, x2: number, y2: number): number {
        return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
    }

    private hasTroopsToAttack(troops: TroopsAmounts): boolean {
        const total = (troops.spearFighters || 0) + (troops.swordFighters || 0) + 
            (troops.axeFighters || 0) + (troops.archers || 0) + 
            (troops.magicians || 0) + (troops.horsemen || 0) + (troops.catapults || 0);
        return total > 0;
    }

    private doesUserHaveTroops(attacking: TroopsAmounts, available: TroopsAmounts): boolean {
        return (attacking.spearFighters || 0) <= (available.spearFighters || 0) &&
            (attacking.swordFighters || 0) <= (available.swordFighters || 0) &&
            (attacking.axeFighters || 0) <= (available.axeFighters || 0) &&
            (attacking.archers || 0) <= (available.archers || 0) &&
            (attacking.magicians || 0) <= (available.magicians || 0) &&
            (attacking.horsemen || 0) <= (available.horsemen || 0) &&
            (attacking.catapults || 0) <= (available.catapults || 0);
    }

    private calculateKilledTroops(troops: TroopsAmounts, ratio: number): TroopsAmounts {
        return new TroopsAmounts(
            Math.floor((troops.spearFighters || 0) * ratio),
            Math.floor((troops.swordFighters || 0) * ratio),
            Math.floor((troops.axeFighters || 0) * ratio),
            Math.floor((troops.archers || 0) * ratio),
            Math.floor((troops.magicians || 0) * ratio),
            Math.floor((troops.horsemen || 0) * ratio),
            Math.floor((troops.catapults || 0) * ratio)
        );
    }

    private updateRemainingTroops(village: TroopsAmounts, lost: TroopsAmounts): void {
        village.spearFighters -= lost.spearFighters || 0;
        village.swordFighters -= lost.swordFighters || 0;
        village.axeFighters -= lost.axeFighters || 0;
        village.archers -= lost.archers || 0;
        village.magicians -= lost.magicians || 0;
        village.horsemen -= lost.horsemen || 0;
        village.catapults -= lost.catapults || 0;
    }
}

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
    bossDamageBackPercent,
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
    catapultsAttackingStat
} from 'utils';

const BOSSES_COLLECTION = 'bosses';
const RAID_REPORTS_COLLECTION = 'raidReports';
const USERS_COLLECTION = 'users';
const CLANS_COLLECTION = 'clans';
const GRIDS_COLLECTION = 'grids';
const WORLD_SIZE = 100;
const PROXIMITY_RANGE = 15; // Bosses spawn within this range of villages

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
        const actualDamage = Math.floor(rawDamage * distanceMultiplier);

        // Calculate troop losses (boss fights back)
        // Damage back scales with tier - lower tiers have higher % but lower HP
        const damageBackPercent = bossDamageBackPercent[boss.tier];
        const bossDamageBack = boss.currentHp * damageBackPercent;
        const damageRatio = Math.min(0.5, bossDamageBack / (rawDamage + 1)); // Max 50% loss
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

        // Update user (energy and troops)
        this.updateRemainingTroops(village.troops, lostTroops);
        user.energy -= 1;
        
        await this.dbAccessorService
            .getCollection(USERS_COLLECTION)
            .updateOne({ username }, { $set: user });

        // Update boss
        if (bossDefeated) {
            await this.dbAccessorService
                .getCollection(BOSSES_COLLECTION)
                .updateOne(
                    { _id: boss._id },
                    { $set: { currentHp: 0, isDefeated: true, defeatedAt: new Date() } }
                );

            // Distribute rewards to all clan members
            const rewards = await this.distributeRewards(clan, boss.tier);
            
            return {
                report: new RaidReportDTO(raidReport),
                bossDefeated: true,
                rewards
            };
        } else {
            await this.dbAccessorService
                .getCollection(BOSSES_COLLECTION)
                .updateOne(
                    { _id: boss._id },
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

        // Update each clan member's resources
        for (const memberUsername of clan.members) {
            const member = await this.dbAccessorService
                .getCollection(USERS_COLLECTION)
                .findOne({ username: memberUsername }) as User;
            
            if (!member || !member.villages || member.villages.length === 0) continue;

            // Add rewards to first village (capped by warehouse)
            const village = member.villages[0];
            const maxWood = warehouseStorageByLevel[village.buildingsLevels.woodWarehouseLevel];
            const maxStone = warehouseStorageByLevel[village.buildingsLevels.stoneWarehouseLevel];
            const maxCrop = warehouseStorageByLevel[village.buildingsLevels.cropWarehouseLevel];

            village.resourcesAmounts.woodAmount = Math.min(
                village.resourcesAmounts.woodAmount + rewardAmount,
                maxWood
            );
            village.resourcesAmounts.stonesAmount = Math.min(
                village.resourcesAmounts.stonesAmount + rewardAmount,
                maxStone
            );
            village.resourcesAmounts.cropAmount = Math.min(
                village.resourcesAmounts.cropAmount + rewardAmount,
                maxCrop
            );

            await this.dbAccessorService
                .getCollection(USERS_COLLECTION)
                .updateOne({ username: memberUsername }, { $set: member });

            // Send message to clan member
            await this.messagesService.sendClanNotificationMessage(
                memberUsername,
                `Your clan defeated ${bossNames[tier]}!`,
                `Congratulations! Your clan has defeated the ${bossNames[tier]}.\n\n` +
                `You received ${rewardAmount.toLocaleString()} wood, ${rewardAmount.toLocaleString()} stone, and ${rewardAmount.toLocaleString()} crop!`
            );
        }

        return { wood: rewardAmount, stone: rewardAmount, crop: rewardAmount };
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

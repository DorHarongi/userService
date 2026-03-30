import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ObjectId } from 'mongodb';
import { DbAccessorService } from '../../database/services/db-accessor.service';
import { ServerContextService } from '../../database/services/server-context.service';
import { ReportsService } from '../../reports/services/reports/reports.service';
import { DailyQuestService } from '../../dailyQuests/daily-quest.service';
import { ClanQuestService } from '../../clanQuests/clan-quest.service';
import { User } from '../../user/models/user.entity';
import { Village } from '../../user/models/village.entity';
import { TroopsAmounts } from '../../user/models/troopsAmounts';
import { ResourcesAmounts } from '../../user/models/resourcesAmounts';
import { BossService } from '../../bosses/services/boss.service';
import { OasisService } from '../../oasis/oasis.service';
import { RELIC_NAMES, RELIC_TRANSFER_COOLDOWN_MS, DailyQuestTrackingType, ClanQuestTrackingType } from 'utils';
import {
    wallDefenseByLevel,
    spearFighterDefenceStat,
    swordFighterDefenceStat,
    axeFighterDefenceStat,
    archerDefenceStat,
    magicianDefenceStat,
    horsemenDefenceStat,
    catapultsDefenceStat,
    spearFighterAttackingStat,
    swordFighterAttackingStat,
    axeFighterAttackingStat,
    archerAttackingStat,
    magicianAttackingStat,
    horsemenAttackingStat,
    catapultsAttackingStat,
    lootingAbilityOfTroops,
    warehouseStorageByLevel,
    calculateDistance,
    getArmySpeed,
    calculateTravelTimeMs,
    getSkillBonus,
    SkillCategory,
} from 'utils';
import { AttackReport } from '../../reports/models/attackReport.entity';
import { RelicsService } from '../../relics/relics.service';
import { AnnouncementsService } from '../../announcements/announcements.service';
import { MessagesService } from '../../messages/services/messages.service';
import { MessageType } from '../../messages/models/message.entity';
import { unlockAchievements } from '../../user/services/achievement-utils';
const USERS_COLLECTION = 'users';
const MOVEMENTS_COLLECTION = 'movements';

export interface Movement {
    _id?: ObjectId;
    type: 'attack' | 'support' | 'resources' | 'return' | 'oasis_return' | 'boss_attack' | 'relic_transfer' | 'oasis_garrison' | 'oasis_attack';
    senderUsername: string;
    senderVillageName: string;
    targetUsername: string;
    targetVillageName: string;
    troops?: TroopsAmounts;
    resources?: ResourcesAmounts;
    departureTime: Date;
    arrivalTime: Date;
    status: 'in_transit' | 'processing' | 'completed';
    bossId?: string;
    relicId?: string;
    oasisId?: string;
    oasisName?: string;
    oasisX?: number;
    oasisY?: number;
}

@Injectable()
export class MovementService {
    private readonly logger = new Logger(MovementService.name);

    constructor(
        private dbAccessorService: DbAccessorService,
        private serverContextService: ServerContextService,
        private reportsService: ReportsService,
        private relicsService: RelicsService,
        private announcementsService: AnnouncementsService,
        private messagesService: MessagesService,
        private dailyQuestService: DailyQuestService,
        private clanQuestService: ClanQuestService,
        @Inject(forwardRef(() => BossService)) private bossService: BossService,
        @Inject(forwardRef(() => OasisService)) private oasisService: OasisService,
    ) {}

    @Cron('*/10 * * * * *')
    async processArrivedMovements(): Promise<void> {
        await this.serverContextService.forEachServer(async () => {
            const now = new Date();
            const collection = this.dbAccessorService.getCollection(MOVEMENTS_COLLECTION);
            const movements = await collection
                .find({ arrivalTime: { $lte: now }, status: 'in_transit' })
                .toArray() as Movement[];

            for (const movement of movements) {
                const claimed = await collection.findOneAndUpdate(
                    { _id: movement._id, status: 'in_transit' },
                    { $set: { status: 'processing' } },
                );
                const claimedDoc = (claimed as any)?.value ?? claimed;
                if (!claimedDoc) continue;

                let resolved = false;
                try {
                    if (movement.type === 'attack') {
                        await this.resolveAttackMovement(movement);
                    } else if (movement.type === 'boss_attack') {
                        await this.bossService.resolveBossAttack(movement as any);
                    } else if (movement.type === 'oasis_garrison') {
                        await this.oasisService.resolveOasisGarrisonMovement(movement as any);
                    } else if (movement.type === 'oasis_attack') {
                        await this.oasisService.resolveOasisAttackMovement(movement as any);
                    } else if (movement.type === 'support') {
                        await this.resolveSupportMovement(movement);
                    } else if (movement.type === 'resources') {
                        await this.resolveResourcesMovement(movement);
                    } else if (movement.type === 'return') {
                        await this.resolveReturnMovement(movement);
                    } else if (movement.type === 'oasis_return') {
                        await this.resolveOasisReturnMovement(movement);
                    } else if (movement.type === 'relic_transfer') {
                        await this.resolveRelicTransferMovement(movement);
                    }
                    resolved = true;
                } catch (error) {
                    this.logger.error(`Error processing movement ${movement._id}: ${error?.message || error}`);
                }

                await collection.updateOne(
                    { _id: movement._id },
                    { $set: { status: resolved ? 'completed' : 'failed' } },
                );
            }
        });
    }

    async getUserMovements(username: string): Promise<any[]> {
        const movements = await this.dbAccessorService.getCollection(MOVEMENTS_COLLECTION)
            .find({
                status: { $in: ['in_transit', 'processing'] },
                $or: [{ senderUsername: username }, { targetUsername: username }],
            })
            .sort({ arrivalTime: 1 })
            .toArray() as Movement[];

        const spyMissions = await this.dbAccessorService.getCollection('spyMissions')
            .find({
                attackerUsername: username,
                status: { $in: ['in_transit', 'returning'] },
            })
            .sort({ arrivalTime: 1 })
            .toArray() as any[];

        const spyAsMovements = spyMissions.map((m: any) => ({
            type: m.status === 'returning' ? 'spy_return' : 'spy',
            senderUsername: m.attackerUsername,
            senderVillageName: m.attackerVillageName,
            targetUsername: m.targetType === 'oasis' ? (m.oasisName || 'Oasis') : m.defenderUsername,
            targetVillageName: m.targetType === 'oasis' ? (m.oasisName || 'Oasis') : m.defenderVillageName,
            departureTime: m.departureTime,
            arrivalTime: m.arrivalTime,
            status: 'in_transit',
        }));

        return [...movements, ...spyAsMovements];
    }

    private async resolveAttackMovement(movement: Movement): Promise<void> {
        if (!movement.troops) {
            return;
        }

        const attacker = await this.dbAccessorService
            .getCollection(USERS_COLLECTION)
            .findOne({ username: movement.senderUsername }) as User;
        const defender = await this.dbAccessorService
            .getCollection(USERS_COLLECTION)
            .findOne({ username: movement.targetUsername }) as User;

        if (!attacker || !defender) {
            return;
        }

        const attackerVillage = attacker.villages.find(v => v.villageName === movement.senderVillageName);
        const defenderVillage = defender.villages.find(v => v.villageName === movement.targetVillageName);

        if (!attackerVillage || !defenderVillage) {
            return;
        }

        const attackerTroops = movement.troops;
        const defenceTroops = defenderVillage.troops;
        const supportTroops = defenderVillage.clanTroops;
        const wallLevel = defenderVillage.buildingsLevels.wallLevel;

        const baseAttackingPower = this.calculateAttackingPower(attackerTroops);

        // Sharper Blades skill: increases attacking power
        const attackerSkills = attackerVillage.skills;
        const sharperBladesBonus = getSkillBonus(attackerSkills, SkillCategory.SHARPER_BLADES);
        const attackingPower = Math.floor(baseAttackingPower * (1 + sharperBladesBonus));

        const baseVillageDefence = this.calculateVillageDefence(defenceTroops, supportTroops, wallLevel);

        // Heroic Shield skill: increases total defence when defending
        const defenderSkills = defenderVillage.skills;
        const heroicShieldBonus = getSkillBonus(defenderSkills, SkillCategory.HEROIC_SHIELD);
        const villageDefence = Math.floor(baseVillageDefence * (1 + heroicShieldBonus));

        const attackToDefenceRatio = attackingPower / (villageDefence || 1);
        const defenceToAttackRatio = villageDefence / (attackingPower || 1);

        let killedAttackerTroops: TroopsAmounts;
        let killedDefenderTroops: TroopsAmounts;
        let killedSupportTroops: TroopsAmounts;

        let attackWon: boolean;

        if (attackToDefenceRatio <= 1) {
            attackWon = false;
            killedAttackerTroops = this.calculateKilledTroopsByRatio(attackerTroops, 1);
            killedDefenderTroops = this.calculateKilledTroopsByRatio(defenceTroops, attackToDefenceRatio);
            killedSupportTroops = this.calculateKilledTroopsByRatio(supportTroops, attackToDefenceRatio);
        } else {
            attackWon = true;
            killedDefenderTroops = this.calculateKilledTroopsByRatio(defenceTroops, 1);
            killedSupportTroops = this.calculateKilledTroopsByRatio(supportTroops, 1);

            const killedRatio = defenceToAttackRatio;

            killedAttackerTroops = this.calculateKilledTroopsByRatio(attackerTroops, killedRatio);
        }

        let loot = new ResourcesAmounts(0, 0, 0);
        if (attackWon) {
            loot = this.calculateLoot(attackerTroops, defenderVillage.resourcesAmounts);

            const filthyThiefBonus = getSkillBonus(attackerSkills, SkillCategory.FILTHY_THIEF);
            const ironVaultBonus = getSkillBonus(defenderSkills, SkillCategory.IRON_VAULT);
            const lootModifier = Math.max(0, 1 + filthyThiefBonus - ironVaultBonus);
            if (lootModifier !== 1) {
                loot = new ResourcesAmounts(
                    Math.floor(loot.woodAmount * lootModifier),
                    Math.floor(loot.stonesAmount * lootModifier),
                    Math.floor(loot.cropAmount * lootModifier),
                );
            }

            this.decreaseLootFromDefender(loot, defenderVillage);
        }

        const attackReport = new AttackReport(
            movement.senderUsername,
            attackerVillage.villageName,
            movement.targetUsername,
            defenderVillage.villageName,
            new Date(),
            attackWon,
            loot,
            attackingPower,
            villageDefence,
            this.calculateTroopsDefence(defenceTroops),
            this.calculateAttackingPower(supportTroops),
            wallDefenseByLevel[wallLevel],
            attackerTroops,
            killedAttackerTroops,
            defenceTroops,
            killedDefenderTroops,
            supportTroops,
            killedSupportTroops,
            'pvp',
        );
        attackReport.attackerVillageX = attackerVillage.location.x;
        attackReport.attackerVillageY = attackerVillage.location.y;
        attackReport.defenderVillageX = defenderVillage.location.x;
        attackReport.defenderVillageY = defenderVillage.location.y;

        await this.reportsService.saveAttackReport(attackReport);

        // Relic stealing: attacker wins with total wipe (all defender + support dead)
        const totalWipe =
            attackWon &&
            defenceTroops.spearFighters + defenceTroops.swordFighters + defenceTroops.axeFighters +
            defenceTroops.archers + defenceTroops.magicians + defenceTroops.horsemen + defenceTroops.catapults ===
            killedDefenderTroops.spearFighters + killedDefenderTroops.swordFighters + killedDefenderTroops.axeFighters +
            killedDefenderTroops.archers + killedDefenderTroops.magicians + killedDefenderTroops.horsemen + killedDefenderTroops.catapults &&
            supportTroops.spearFighters + supportTroops.swordFighters + supportTroops.axeFighters +
            supportTroops.archers + supportTroops.magicians + supportTroops.horsemen + supportTroops.catapults ===
            killedSupportTroops.spearFighters + killedSupportTroops.swordFighters + killedSupportTroops.axeFighters +
            killedSupportTroops.archers + killedSupportTroops.magicians + killedSupportTroops.horsemen + killedSupportTroops.catapults;
        if (totalWipe) {
            const stolenNames = await this.relicsService.stealRelicsFromVillage(
                movement.targetUsername,
                defenderVillage.villageName,
                movement.senderUsername,
                attackerVillage.villageName,
                attacker.clanName || null,
            );
            if (stolenNames.length > 0) {
                attacker.totalStats = attacker.totalStats || { lifetimeBossDamage: 0, lifetimeResourcesStolen: 0, totalBattlesWon: 0, successfulSpies: 0, relicsStolen: 0, resourcesSentToClan: 0, mythicBossDamage: 0, supportTroopsSent: 0, oasesConquered: 0, pvpWinStreak: 0 };
                attacker.totalStats.relicsStolen = (attacker.totalStats.relicsStolen || 0) + stolenNames.length;
            }
            for (const relicName of stolenNames) {
                const attackerLabel = attacker.clanName
                    ? `{clan:${attacker.clanName}}`
                    : `{player:${attacker.username}} (clanless)`;
                const defenderLabel = defender.clanName
                    ? `{player:${defender.username}} of {clan:${defender.clanName}}`
                    : `{player:${defender.username}} (clanless)`;
                await this.messagesService.sendGlobalInboxMessage(
                    `A Divine Relic has been stolen!`,
                    `${attackerLabel} seized the ${relicName} from ${defenderLabel}. The balance of power shifts.`,
                );
            }
        }

        // Calculate surviving attackers for return trip
        const survivingAttackers = new TroopsAmounts(
            Math.max(0, attackerTroops.spearFighters - killedAttackerTroops.spearFighters),
            Math.max(0, attackerTroops.swordFighters - killedAttackerTroops.swordFighters),
            Math.max(0, attackerTroops.axeFighters - killedAttackerTroops.axeFighters),
            Math.max(0, attackerTroops.archers - killedAttackerTroops.archers),
            Math.max(0, attackerTroops.magicians - killedAttackerTroops.magicians),
            Math.max(0, attackerTroops.horsemen - killedAttackerTroops.horsemen),
            Math.max(0, attackerTroops.catapults - killedAttackerTroops.catapults),
        );

        // Update defender troops and resources
        this.updateRemainingTroopsInVillage(defenceTroops, killedDefenderTroops);
        this.updateRemainingTroopsInVillage(supportTroops, killedSupportTroops);

        // Ensure no negative values
        this.clampNonNegative(defenceTroops);
        this.clampNonNegative(supportTroops);

        defenderVillage.resourcesAmounts.woodAmount = Math.max(0, defenderVillage.resourcesAmounts.woodAmount);
        defenderVillage.resourcesAmounts.cropAmount = Math.max(0, defenderVillage.resourcesAmounts.cropAmount);
        defenderVillage.resourcesAmounts.stonesAmount = Math.max(0, defenderVillage.resourcesAmounts.stonesAmount);

        // Persist defender
        await this.dbAccessorService.getCollection(USERS_COLLECTION).updateOne(
            { username: movement.targetUsername },
            { $set: defender },
        );

        // Sync supportSent on senders when support troops die
        await this.syncSupportSentAfterCombat(
            movement.targetUsername,
            defenderVillage.villageName,
            killedSupportTroops,
        );

        // Update stats
        const lootTotal = loot.woodAmount + loot.stonesAmount + loot.cropAmount;

        attacker.weeklyStats = attacker.weeklyStats || {
            bossDamage: 0,
            resourcesStolen: 0,
            successfulDefenses: 0,
        };
        attacker.totalStats = attacker.totalStats || {
            lifetimeBossDamage: 0,
            lifetimeResourcesStolen: 0,
            totalBattlesWon: 0,
            successfulSpies: 0,
            relicsStolen: 0,
            resourcesSentToClan: 0,
            mythicBossDamage: 0,
            supportTroopsSent: 0,
            oasesConquered: 0,
            pvpWinStreak: 0,
        };

        defender.weeklyStats = defender.weeklyStats || {
            bossDamage: 0,
            resourcesStolen: 0,
            successfulDefenses: 0,
        };
        defender.totalStats = defender.totalStats || {
            lifetimeBossDamage: 0,
            lifetimeResourcesStolen: 0,
            totalBattlesWon: 0,
            successfulSpies: 0,
            relicsStolen: 0,
            resourcesSentToClan: 0,
            mythicBossDamage: 0,
            supportTroopsSent: 0,
            oasesConquered: 0,
            pvpWinStreak: 0,
        };

        const attackerTroopsKilled =
            killedAttackerTroops.spearFighters + killedAttackerTroops.swordFighters +
            killedAttackerTroops.axeFighters + killedAttackerTroops.archers +
            killedAttackerTroops.magicians + killedAttackerTroops.horsemen +
            killedAttackerTroops.catapults;

        defender.weeklyStats.successfulDefenses += attackerTroopsKilled;

        if (attackWon) {
            attacker.weeklyStats.resourcesStolen += lootTotal;
            attacker.totalStats.lifetimeResourcesStolen += lootTotal;
            attacker.totalStats.totalBattlesWon += 1;
            attacker.totalStats.pvpWinStreak = (attacker.totalStats.pvpWinStreak || 0) + 1;
            unlockAchievements(attacker, ['totalStats.lifetimeResourcesStolen', 'totalStats.totalBattlesWon', 'totalStats.pvpWinStreak']);

            // Daily + clan quest progress for attacker win
            const totalAttackerTroopsSent =
                attackerTroops.spearFighters + attackerTroops.swordFighters +
                attackerTroops.axeFighters + attackerTroops.archers +
                attackerTroops.magicians + attackerTroops.horsemen +
                attackerTroops.catapults;
            let dailyChain = this.dailyQuestService.incrementProgress(attacker.username, DailyQuestTrackingType.WIN_PVP_ATTACKS, 1)
                .then(() => this.dailyQuestService.handlePvpBattleResult(attacker.username, true));
            if (lootTotal > 0) {
                dailyChain = dailyChain.then(() =>
                    this.dailyQuestService.incrementProgress(attacker.username, DailyQuestTrackingType.STEAL_RESOURCES, lootTotal));
            }
            if (totalAttackerTroopsSent > 0 && attackerTroopsKilled / totalAttackerTroopsSent < 0.2) {
                dailyChain = dailyChain.then(() =>
                    this.dailyQuestService.incrementProgress(attacker.username, DailyQuestTrackingType.WIN_WITH_LOW_LOSSES, 1));
            }
            dailyChain.catch(() => {});
            if (attacker.clanName) {
                this.clanQuestService.incrementClanProgress(attacker.clanName, attacker.username, ClanQuestTrackingType.TOTAL_PVP_WINS, 1).catch(() => {});
                if (lootTotal > 0) {
                    this.clanQuestService.incrementClanProgress(attacker.clanName, attacker.username, ClanQuestTrackingType.TOTAL_RESOURCES_STOLEN, lootTotal).catch(() => {});
                }
            }
        } else {
            this.dailyQuestService.handlePvpBattleResult(attacker.username, false).catch(() => {});
            attacker.totalStats.pvpWinStreak = 0;
            defender.totalStats.totalBattlesWon += 1;
            unlockAchievements(defender, ['weeklyStats.successfulDefenses', 'totalStats.totalBattlesWon']);
        }

        // Decrement troopsInTransit: dead troops are gone, survivors remain in transit for return
        const totalSent =
            attackerTroops.spearFighters + attackerTroops.swordFighters +
            attackerTroops.axeFighters + attackerTroops.archers +
            attackerTroops.magicians + attackerTroops.horsemen +
            attackerTroops.catapults;
        const totalSurviving =
            survivingAttackers.spearFighters +
            survivingAttackers.swordFighters +
            survivingAttackers.axeFighters +
            survivingAttackers.archers +
            survivingAttackers.magicians +
            survivingAttackers.horsemen +
            survivingAttackers.catapults;
        const willHaveReturnMovement = totalSurviving > 0 || lootTotal > 0;
        const transitDecrement = willHaveReturnMovement ? attackerTroopsKilled : totalSent;
        attackerVillage.troopsInTransit = Math.max(0, (attackerVillage.troopsInTransit || 0) - transitDecrement);

        await this.dbAccessorService.getCollection(USERS_COLLECTION).updateOne(
            { username: attacker.username },
            { $set: attacker },
        );

        await this.dbAccessorService.getCollection(USERS_COLLECTION).updateOne(
            { username: defender.username },
            { $set: { weeklyStats: defender.weeklyStats, totalStats: defender.totalStats, unlockedAchievements: (defender as any).unlockedAchievements } },
        );

        if (willHaveReturnMovement) {
            const distance = calculateDistance(
                attackerVillage.location.x,
                attackerVillage.location.y,
                defenderVillage.location.x,
                defenderVillage.location.y,
            );
            const armySpeed = getArmySpeed(survivingAttackers as any);
            const quickStepBonus = getSkillBonus(attackerVillage.skills, SkillCategory.QUICK_STEP);
            const travelTimeMs = calculateTravelTimeMs(distance, armySpeed, quickStepBonus);
            const departureTime = new Date();
            const arrivalTime = new Date(departureTime.getTime() + travelTimeMs);

            const returnMovement: Movement = {
                type: 'return',
                senderUsername: attacker.username,
                senderVillageName: attackerVillage.villageName,
                targetUsername: attacker.username,
                targetVillageName: attackerVillage.villageName,
                troops: survivingAttackers,
                resources: loot,
                departureTime,
                arrivalTime,
                status: 'in_transit',
            };

            await this.dbAccessorService
                .getCollection(MOVEMENTS_COLLECTION)
                .insertOne(returnMovement);
        }
    }

    private async resolveReturnMovement(movement: Movement): Promise<void> {
        const user = await this.dbAccessorService
            .getCollection(USERS_COLLECTION)
            .findOne({ username: movement.targetUsername }) as User;

        if (!user) {
            return;
        }

        const village = user.villages.find(v => v.villageName === movement.targetVillageName);
        if (!village) {
            return;
        }

        if (movement.troops) {
            this.addTroops(village.troops, movement.troops);
            const returningCount =
                (movement.troops.spearFighters || 0) + (movement.troops.swordFighters || 0) +
                (movement.troops.axeFighters || 0) + (movement.troops.archers || 0) +
                (movement.troops.magicians || 0) + (movement.troops.horsemen || 0) +
                (movement.troops.catapults || 0);
            village.troopsInTransit = Math.max(0, (village.troopsInTransit || 0) - returningCount);
        }

        if (movement.resources) {
            const maxWood = warehouseStorageByLevel[village.buildingsLevels.woodWarehouseLevel];
            const maxStone = warehouseStorageByLevel[village.buildingsLevels.stoneWarehouseLevel];
            const maxCrop = warehouseStorageByLevel[village.buildingsLevels.cropWarehouseLevel];

            village.resourcesAmounts.woodAmount = Math.min(
                village.resourcesAmounts.woodAmount + movement.resources.woodAmount,
                maxWood,
            );
            village.resourcesAmounts.stonesAmount = Math.min(
                village.resourcesAmounts.stonesAmount + movement.resources.stonesAmount,
                maxStone,
            );
            village.resourcesAmounts.cropAmount = Math.min(
                village.resourcesAmounts.cropAmount + movement.resources.cropAmount,
                maxCrop,
            );
        }

        await this.dbAccessorService
            .getCollection(USERS_COLLECTION)
            .updateOne({ username: user.username }, { $set: user });
    }

    private async resolveOasisReturnMovement(movement: Movement): Promise<void> {
        const sent = {
            wood: Math.floor(movement.resources?.woodAmount || 0),
            stone: Math.floor(movement.resources?.stonesAmount || 0),
            crop: Math.floor(movement.resources?.cropAmount || 0),
        };

        let received = { ...sent };
        const userBefore = await this.dbAccessorService
            .getCollection(USERS_COLLECTION)
            .findOne({ username: movement.targetUsername }) as User;
        const villageBefore = userBefore?.villages?.find(v => v.villageName === movement.targetVillageName);
        if (villageBefore && movement.resources) {
            const maxWood = warehouseStorageByLevel[villageBefore.buildingsLevels.woodWarehouseLevel];
            const maxStone = warehouseStorageByLevel[villageBefore.buildingsLevels.stoneWarehouseLevel];
            const maxCrop = warehouseStorageByLevel[villageBefore.buildingsLevels.cropWarehouseLevel];

            received.wood = Math.min(sent.wood, Math.max(0, maxWood - villageBefore.resourcesAmounts.woodAmount));
            received.stone = Math.min(sent.stone, Math.max(0, maxStone - villageBefore.resourcesAmounts.stonesAmount));
            received.crop = Math.min(sent.crop, Math.max(0, maxCrop - villageBefore.resourcesAmounts.cropAmount));
        }

        await this.resolveReturnMovement(movement);

        const hasLoot = sent.wood > 0 || sent.stone > 0 || sent.crop > 0;
        const oasisLabel = movement.oasisName && movement.oasisX != null && movement.oasisId
            ? `{oasis:${movement.oasisName}|${movement.oasisX}|${movement.oasisY}|${movement.oasisId}}`
            : movement.oasisName || 'the oasis';

        const user = await this.dbAccessorService
            .getCollection(USERS_COLLECTION)
            .findOne({ username: movement.targetUsername }) as User;
        const village = user?.villages?.find(v => v.villageName === movement.targetVillageName);
        const villageLabel = village
            ? `{village:${movement.targetVillageName}|${village.location.x}|${village.location.y}}`
            : movement.targetVillageName;

        const hasOverflow = received.wood < sent.wood || received.stone < sent.stone || received.crop < sent.crop;
        const content = hasLoot
            ? hasOverflow
                ? `Your troops have returned from ${oasisLabel} to ${villageLabel}. Some resources were lost due to full warehouses.`
                : `Your troops have returned from ${oasisLabel} to ${villageLabel}.`
            : `Your troops have returned from ${oasisLabel} to ${villageLabel} with no resources.`;

        const metadata: any = {};
        if (hasLoot) {
            metadata.resources = sent;
            metadata.received = received;
        }

        await this.messagesService.sendClanNotificationMessage(
            movement.targetUsername,
            'Oasis Troops Returned',
            content,
            MessageType.OASIS_RETURN,
            hasLoot ? metadata : undefined,
        );
    }

    private async resolveSupportMovement(movement: Movement): Promise<void> {
        if (!movement.troops) {
            return;
        }

        const recipient = await this.dbAccessorService
            .getCollection(USERS_COLLECTION)
            .findOne({ username: movement.targetUsername }) as User;

        if (!recipient) {
            return;
        }

        const recipientVillage = recipient.villages.find(v => v.villageName === movement.targetVillageName);
        if (!recipientVillage) {
            return;
        }

        this.addTroops(recipientVillage.clanTroops, movement.troops);

        await this.dbAccessorService
            .getCollection(USERS_COLLECTION)
            .updateOne({ username: recipient.username }, { $set: recipient });
    }

    private async resolveResourcesMovement(movement: Movement): Promise<void> {
        if (!movement.resources) {
            return;
        }

        const recipient = await this.dbAccessorService
            .getCollection(USERS_COLLECTION)
            .findOne({ username: movement.targetUsername }) as User;

        if (!recipient) {
            return;
        }

        const recipientVillage = recipient.villages.find(v => v.villageName === movement.targetVillageName);
        if (!recipientVillage) {
            return;
        }

        const maxWood = warehouseStorageByLevel[recipientVillage.buildingsLevels.woodWarehouseLevel];
        const maxStone = warehouseStorageByLevel[recipientVillage.buildingsLevels.stoneWarehouseLevel];
        const maxCrop = warehouseStorageByLevel[recipientVillage.buildingsLevels.cropWarehouseLevel];

        recipientVillage.resourcesAmounts.woodAmount = Math.min(
            recipientVillage.resourcesAmounts.woodAmount + movement.resources.woodAmount,
            maxWood,
        );
        recipientVillage.resourcesAmounts.stonesAmount = Math.min(
            recipientVillage.resourcesAmounts.stonesAmount + movement.resources.stonesAmount,
            maxStone,
        );
        recipientVillage.resourcesAmounts.cropAmount = Math.min(
            recipientVillage.resourcesAmounts.cropAmount + movement.resources.cropAmount,
            maxCrop,
        );

        await this.dbAccessorService
            .getCollection(USERS_COLLECTION)
            .updateOne({ username: recipient.username }, { $set: recipient });

        // Notify recipient that resources have arrived
        await this.messagesService.sendResourceTransferMessage(
            movement.senderUsername,
            movement.targetUsername,
            movement.senderVillageName,
            movement.targetVillageName,
            {
                wood: movement.resources.woodAmount,
                stone: movement.resources.stonesAmount,
                crop: movement.resources.cropAmount,
            },
            false, // recipient message
        );
    }

    private async resolveRelicTransferMovement(movement: Movement): Promise<void> {
        if (!movement.relicId) return;

        const targetUser = await this.dbAccessorService.getCollection(USERS_COLLECTION)
            .findOne({ username: movement.targetUsername }) as User;
        if (!targetUser) return;

        const hasVillage = targetUser.villages?.some(
            (v) => v.villageName === movement.targetVillageName,
        );
        if (!hasVillage) return;

        const relicDef = RELIC_NAMES.find((r) => r.id === movement.relicId);
        const relicName = relicDef?.name ?? movement.relicId;
        const cooldownUntil = new Date(Date.now() + RELIC_TRANSFER_COOLDOWN_MS);

        await this.dbAccessorService.getCollection('relics').updateOne(
            { relicId: movement.relicId },
            {
                $set: {
                    holderUsername: movement.targetUsername,
                    holderVillageName: movement.targetVillageName,
                    holderClanName: targetUser.clanName || null,
                    transferCooldownUntil: cooldownUntil,
                    obtainedAt: new Date(),
                },
            },
        );

        await this.relicsService.checkWinAfterChange();

        const targetVillage = targetUser.villages?.find(
            (v) => v.villageName === movement.targetVillageName,
        );
        const villageRef = targetVillage
            ? `{village:${movement.targetVillageName}|${targetVillage.location.x}|${targetVillage.location.y}}`
            : movement.targetVillageName;
        await this.messagesService.sendGlobalInboxMessage(
            'A Divine Relic has been moved!',
            `The ${relicName} has been transferred to {player:${movement.targetUsername}} in ${villageRef}.`,
        );
    }

    private calculateAttackingPower(attackingTroops: TroopsAmounts): number {
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

    private calculateTroopsDefence(troops: TroopsAmounts): number {
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

    private calculateVillageDefence(defenceTroops: TroopsAmounts, supportTroops: TroopsAmounts, wallLevel: number): number {
        return (
            this.calculateTroopsDefence(defenceTroops) +
            this.calculateTroopsDefence(supportTroops) +
            wallDefenseByLevel[wallLevel]
        );
    }

    private calculateKilledTroopsByRatio(troops: TroopsAmounts, ratio: number): TroopsAmounts {
        if (ratio > 1 || ratio < 0) {
            return new TroopsAmounts(0, 0, 0, 0, 0, 0, 0);
        }

        const killedTroops = new TroopsAmounts(0, 0, 0, 0, 0, 0, 0);
        killedTroops.spearFighters = Math.floor(ratio * troops.spearFighters);
        killedTroops.swordFighters = Math.floor(ratio * troops.swordFighters);
        killedTroops.axeFighters = Math.floor(ratio * troops.axeFighters);
        killedTroops.archers = Math.floor(ratio * troops.archers);
        killedTroops.magicians = Math.floor(ratio * troops.magicians);
        killedTroops.horsemen = Math.floor(ratio * troops.horsemen);
        killedTroops.catapults = Math.floor(ratio * troops.catapults);

        return killedTroops;
    }

    private updateRemainingTroopsInVillage(villageTroops: TroopsAmounts, killedTroops: TroopsAmounts): void {
        villageTroops.spearFighters -= killedTroops.spearFighters;
        villageTroops.swordFighters -= killedTroops.swordFighters;
        villageTroops.axeFighters -= killedTroops.axeFighters;
        villageTroops.archers -= killedTroops.archers;
        villageTroops.magicians -= killedTroops.magicians;
        villageTroops.horsemen -= killedTroops.horsemen;
        villageTroops.catapults -= killedTroops.catapults;
    }

    private calculateLoot(remainingAttackerTroops: TroopsAmounts, defenderResources: ResourcesAmounts): ResourcesAmounts {
        const totalPossibleLootFromEachResource = this.calculateTotalPossibleLootFromEachResource(remainingAttackerTroops);
        const lootedWood = Math.min(totalPossibleLootFromEachResource, defenderResources.woodAmount);
        const lootedStones = Math.min(totalPossibleLootFromEachResource, defenderResources.stonesAmount);
        const lootedCrop = Math.min(totalPossibleLootFromEachResource, defenderResources.cropAmount);
        return new ResourcesAmounts(lootedWood, lootedStones, lootedCrop);
    }

    private calculateTotalPossibleLootFromEachResource(attackerTroops: TroopsAmounts): number {
        const totalRemainingTroops =
            attackerTroops.spearFighters +
            attackerTroops.swordFighters +
            attackerTroops.axeFighters +
            attackerTroops.archers +
            attackerTroops.magicians +
            attackerTroops.horsemen +
            attackerTroops.catapults;

        return totalRemainingTroops * lootingAbilityOfTroops;
    }

    private decreaseLootFromDefender(loot: ResourcesAmounts, defenderVillage: Village): void {
        defenderVillage.resourcesAmounts.woodAmount -= loot.woodAmount;
        defenderVillage.resourcesAmounts.cropAmount -= loot.cropAmount;
        defenderVillage.resourcesAmounts.stonesAmount -= loot.stonesAmount;
    }

    private addTroops(to: TroopsAmounts, amount: TroopsAmounts): void {
        to.spearFighters += amount.spearFighters;
        to.swordFighters += amount.swordFighters;
        to.axeFighters += amount.axeFighters;
        to.archers += amount.archers;
        to.magicians += amount.magicians;
        to.horsemen += amount.horsemen;
        to.catapults += amount.catapults;
    }

    private clampNonNegative(troops: TroopsAmounts): void {
        troops.spearFighters = Math.max(0, troops.spearFighters);
        troops.swordFighters = Math.max(0, troops.swordFighters);
        troops.axeFighters = Math.max(0, troops.axeFighters);
        troops.archers = Math.max(0, troops.archers);
        troops.magicians = Math.max(0, troops.magicians);
        troops.horsemen = Math.max(0, troops.horsemen);
        troops.catapults = Math.max(0, troops.catapults);
    }

    private async syncSupportSentAfterCombat(
        defenderUsername: string,
        defenderVillageName: string,
        killedSupportTroops: TroopsAmounts,
    ): Promise<void> {
        const totalKilled =
            killedSupportTroops.spearFighters + killedSupportTroops.swordFighters +
            killedSupportTroops.axeFighters + killedSupportTroops.archers +
            killedSupportTroops.magicians + killedSupportTroops.horsemen +
            killedSupportTroops.catapults;
        if (totalKilled === 0) return;

        const troopTypes: (keyof TroopsAmounts)[] = [
            'spearFighters', 'swordFighters', 'axeFighters', 'archers',
            'magicians', 'horsemen', 'catapults',
        ];

        const supporters = await this.dbAccessorService.getCollection(USERS_COLLECTION).find({
            'villages.supportSent': {
                $elemMatch: {
                    recipientUsername: defenderUsername,
                    recipientVillageName: defenderVillageName,
                },
            },
        }).toArray() as User[];

        for (const supporter of supporters) {
            let changed = false;
            for (const village of supporter.villages) {
                if (!village.supportSent) continue;
                const entry = village.supportSent.find(
                    s => s.recipientUsername === defenderUsername &&
                         s.recipientVillageName === defenderVillageName,
                );
                if (!entry) continue;

                const totalSentByThis: Record<string, number> = {};
                const totalSentAll: Record<string, number> = {};
                for (const t of troopTypes) {
                    totalSentByThis[t] = entry.troops[t] || 0;
                    totalSentAll[t] = 0;
                }

                for (const sup of supporters) {
                    for (const v of sup.villages) {
                        const e = v.supportSent?.find(
                            s => s.recipientUsername === defenderUsername &&
                                 s.recipientVillageName === defenderVillageName,
                        );
                        if (e) {
                            for (const t of troopTypes) {
                                totalSentAll[t] += e.troops[t] || 0;
                            }
                        }
                    }
                }

                for (const t of troopTypes) {
                    const killed = killedSupportTroops[t] || 0;
                    if (killed <= 0 || totalSentAll[t] <= 0) continue;
                    const share = totalSentByThis[t] / totalSentAll[t];
                    const loss = Math.min(entry.troops[t], Math.round(killed * share));
                    if (loss > 0) {
                        entry.troops[t] = Math.max(0, entry.troops[t] - loss);
                        changed = true;
                    }
                }

                const remaining = troopTypes.reduce((sum, t) => sum + (entry.troops[t] || 0), 0);
                if (remaining === 0) {
                    village.supportSent = village.supportSent.filter(s => s !== entry);
                    changed = true;
                }
            }

            if (changed) {
                await this.dbAccessorService.getCollection(USERS_COLLECTION).updateOne(
                    { username: supporter.username },
                    { $set: { villages: supporter.villages } },
                );
            }
        }
    }
}


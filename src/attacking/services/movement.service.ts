import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ObjectId } from 'mongodb';
import { DbAccessorService } from '../../database/services/db-accessor.service';
import { ReportsService } from '../../reports/services/reports/reports.service';
import { User } from '../../user/models/user.entity';
import { Village } from '../../user/models/village.entity';
import { TroopsAmounts } from '../../user/models/troopsAmounts';
import { ResourcesAmounts } from '../../user/models/resourcesAmounts';
import { BossService } from '../../bosses/services/boss.service';
import { RELIC_NAMES, RELIC_TRANSFER_COOLDOWN_MS } from 'utils';
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
import { unlockAchievements } from '../../user/services/achievement-utils';
const USERS_COLLECTION = 'users';
const MOVEMENTS_COLLECTION = 'movements';

export interface Movement {
    _id?: ObjectId;
    type: 'attack' | 'support' | 'resources' | 'return' | 'boss_attack' | 'relic_transfer';
    senderUsername: string;
    senderVillageName: string;
    targetUsername: string;
    targetVillageName: string;
    troops?: TroopsAmounts;
    resources?: ResourcesAmounts;
    departureTime: Date;
    arrivalTime: Date;
    status: 'in_transit' | 'completed';
    bossId?: string;
    relicId?: string;
}

@Injectable()
export class MovementService {
    private readonly logger = new Logger(MovementService.name);

    constructor(
        private dbAccessorService: DbAccessorService,
        private reportsService: ReportsService,
        private relicsService: RelicsService,
        private announcementsService: AnnouncementsService,
        private messagesService: MessagesService,
        @Inject(forwardRef(() => BossService)) private bossService: BossService,
    ) {}

    @Cron('*/10 * * * * *')
    async processArrivedMovements(): Promise<void> {
        const now = new Date();
        const collection = this.dbAccessorService.getCollection(MOVEMENTS_COLLECTION);
        const movements = await collection
            .find({ arrivalTime: { $lte: now }, status: 'in_transit' })
            .toArray() as Movement[];

        for (const movement of movements) {
            try {
                if (movement.type === 'attack') {
                    await this.resolveAttackMovement(movement);
                } else if (movement.type === 'boss_attack') {
                    await this.bossService.resolveBossAttack(movement as any);
                } else if (movement.type === 'support') {
                    await this.resolveSupportMovement(movement);
                } else if (movement.type === 'resources') {
                    await this.resolveResourcesMovement(movement);
                } else if (movement.type === 'return') {
                    await this.resolveReturnMovement(movement);
                } else if (movement.type === 'relic_transfer') {
                    await this.resolveRelicTransferMovement(movement);
                }

                await collection.updateOne(
                    { _id: movement._id },
                    { $set: { status: 'completed' } },
                );
            } catch (error) {
                this.logger.error(`Error processing movement ${movement._id}: ${error?.message || error}`);
            }
        }
    }

    async getUserMovements(username: string): Promise<any[]> {
        const movements = await this.dbAccessorService.getCollection(MOVEMENTS_COLLECTION)
            .find({
                status: 'in_transit',
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
            targetUsername: m.defenderUsername,
            targetVillageName: m.defenderVillageName,
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
            // Self Defense (defender wins): reduce defender losses by defender's bonus
            const defenderSelfDefenseBonus = getSkillBonus(defenderSkills, SkillCategory.SELF_DEFENSE);
            if (defenderSelfDefenseBonus > 0) {
                const reduce = 1 - defenderSelfDefenseBonus;
                killedDefenderTroops = this.scaleTroopsAmounts(killedDefenderTroops, reduce);
                killedSupportTroops = this.scaleTroopsAmounts(killedSupportTroops, reduce);
            }
        } else {
            attackWon = true;
            killedDefenderTroops = this.calculateKilledTroopsByRatio(defenceTroops, 1);
            killedSupportTroops = this.calculateKilledTroopsByRatio(supportTroops, 1);

            let killedRatio = defenceToAttackRatio;

            // Self Defense skill reduces troop losses for the winner only
            const selfDefenseBonus = getSkillBonus(attackerSkills, SkillCategory.SELF_DEFENSE);
            killedRatio = killedRatio * (1 - selfDefenseBonus);

            killedAttackerTroops = this.calculateKilledTroopsByRatio(attackerTroops, killedRatio);
        }

        let loot = new ResourcesAmounts(0, 0, 0);
        if (attackWon) {
            loot = this.calculateLoot(attackerTroops, defenderVillage.resourcesAmounts);

            // Filthy Thief skill: increases looted resources
            const filthyThiefBonus = getSkillBonus(attackerSkills, SkillCategory.FILTHY_THIEF);
            if (filthyThiefBonus > 0) {
                loot = new ResourcesAmounts(
                    Math.floor(loot.woodAmount * (1 + filthyThiefBonus)),
                    Math.floor(loot.stonesAmount * (1 + filthyThiefBonus)),
                    Math.floor(loot.cropAmount * (1 + filthyThiefBonus)),
                );
            }

            // Iron Vault skill: protects a portion of defender resources
            const ironVaultBonus = getSkillBonus(defenderSkills, SkillCategory.IRON_VAULT);
            if (ironVaultBonus > 0) {
                loot = new ResourcesAmounts(
                    Math.floor(loot.woodAmount * (1 - ironVaultBonus)),
                    Math.floor(loot.stonesAmount * (1 - ironVaultBonus)),
                    Math.floor(loot.cropAmount * (1 - ironVaultBonus)),
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
            for (const relicName of stolenNames) {
                const attackerLabel = attacker.clanName
                    ? `Clan ${attacker.clanName}`
                    : `${attacker.username} (clanless)`;
                const defenderLabel = defender.clanName
                    ? `${defender.username} of clan ${defender.clanName}`
                    : `${defender.username} (clanless)`;
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
            unlockAchievements(attacker, ['totalStats.lifetimeResourcesStolen', 'totalStats.totalBattlesWon']);
        } else {
            defender.totalStats.totalBattlesWon += 1;
            unlockAchievements(defender, ['weeklyStats.successfulDefenses', 'totalStats.totalBattlesWon']);
        }

        await this.dbAccessorService.getCollection(USERS_COLLECTION).updateOne(
            { username: attacker.username },
            { $set: attacker },
        );

        await this.dbAccessorService.getCollection(USERS_COLLECTION).updateOne(
            { username: defender.username },
            { $set: { weeklyStats: defender.weeklyStats, totalStats: defender.totalStats, unlockedAchievements: (defender as any).unlockedAchievements } },
        );

        // Create return movement with surviving troops and loot
        const totalSurviving =
            survivingAttackers.spearFighters +
            survivingAttackers.swordFighters +
            survivingAttackers.axeFighters +
            survivingAttackers.archers +
            survivingAttackers.magicians +
            survivingAttackers.horsemen +
            survivingAttackers.catapults;

        if (totalSurviving > 0 || lootTotal > 0) {
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

        await this.messagesService.sendGlobalInboxMessage(
            'A Divine Relic has been moved!',
            `The ${relicName} has been transferred to ${movement.targetUsername} in ${movement.targetVillageName}.`,
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

    /** Scale troop counts by a factor (e.g. for Self Defense loss reduction). */
    private scaleTroopsAmounts(troops: TroopsAmounts, factor: number): TroopsAmounts {
        const out = new TroopsAmounts(0, 0, 0, 0, 0, 0, 0);
        out.spearFighters = Math.floor(troops.spearFighters * factor);
        out.swordFighters = Math.floor(troops.swordFighters * factor);
        out.axeFighters = Math.floor(troops.axeFighters * factor);
        out.archers = Math.floor(troops.archers * factor);
        out.magicians = Math.floor(troops.magicians * factor);
        out.horsemen = Math.floor(troops.horsemen * factor);
        out.catapults = Math.floor(troops.catapults * factor);
        return out;
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
}


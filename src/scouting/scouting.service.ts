import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ObjectId } from 'mongodb';
import { DbAccessorService } from '../database/services/db-accessor.service';
import { ServerContextService } from '../database/services/server-context.service';
import { ReportsService } from '../reports/services/reports/reports.service';
import { User } from '../user/models/user.entity';
import { Village } from '../user/models/village.entity';
import { ResourcesAmounts } from '../user/models/resourcesAmounts';
import { TroopsAmounts } from '../user/models/troopsAmounts';
import { SpyMission } from './models/spyMission.entity';
import {
    SPY_SPEED,
    calculateDistance,
    calculateTravelTimeMs,
    getMaxSpies,
    getDetectionChance,
    getSkillBonus,
    SkillCategory,
    warehouseStorageByLevel,
    oasisTierConfigs,
    OasisTier,
} from 'utils';
import { AttackReport } from '../reports/models/attackReport.entity';
import { Oasis, getTotalGarrisonTroops } from '../oasis/models/oasis.entity';
import { DailyQuestTrackingType, ClanQuestTrackingType } from 'utils';
import { DailyQuestService } from '../dailyQuests/daily-quest.service';
import { ClanQuestService } from '../clanQuests/clan-quest.service';

const USERS_COLLECTION = 'users';
const SPY_MISSIONS_COLLECTION = 'spyMissions';
const OASES_COLLECTION = 'oases';

@Injectable()
export class ScoutingService {
    private readonly logger = new Logger(ScoutingService.name);

    constructor(
        private dbAccessorService: DbAccessorService,
        private serverContextService: ServerContextService,
        private reportsService: ReportsService,
        private dailyQuestService: DailyQuestService,
        private clanQuestService: ClanQuestService,
    ) {}

    async scoutVillage(attackerUsername: string, attackerVillageName: string, defenderUsername: string, defenderVillageName: string): Promise<number> {
        if (attackerUsername === defenderUsername) {
            throw new HttpException("You cannot scout your own account", HttpStatus.BAD_REQUEST);
        }

        const attacker = await this.dbAccessorService
            .getCollection(USERS_COLLECTION)
            .findOne({ username: attackerUsername }) as User;
        const defender = await this.dbAccessorService
            .getCollection(USERS_COLLECTION)
            .findOne({ username: defenderUsername }) as User;

        if (!attacker || !defender) {
            throw new HttpException("Attacker or defender not found", HttpStatus.NOT_FOUND);
        }

        if (attacker.clanName && defender.clanName && attacker.clanName === defender.clanName) {
            throw new HttpException("You cannot scout villages in your own clan", HttpStatus.BAD_REQUEST);
        }

        const attackerVillage = attacker.villages.find(v => v.villageName?.trim() === attackerVillageName?.trim());
        const defenderVillage = defender.villages.find(v => v.villageName?.trim() === defenderVillageName?.trim());

        if (!attackerVillage) {
            throw new HttpException("Attacker village not found", HttpStatus.NOT_FOUND);
        }
        if (!defenderVillage) {
            throw new HttpException("Defender village not found", HttpStatus.NOT_FOUND);
        }

        if (attackerVillage.buildingsLevels.stableLevel <= 0) {
            throw new HttpException("You need a Stable to send spies", HttpStatus.BAD_REQUEST);
        }

        const maxSpies = getMaxSpies(attackerVillage.buildingsLevels.stableLevel);
        const aliveSpies = attackerVillage.aliveSpies ?? 0;

        if (aliveSpies <= 0) {
            throw new HttpException("No available spies", HttpStatus.BAD_REQUEST);
        }

        const distance = calculateDistance(
            attackerVillage.location.x,
            attackerVillage.location.y,
            defenderVillage.location.x,
            defenderVillage.location.y,
        );

        const quickStepBonus = getSkillBonus(attackerVillage.skills, SkillCategory.QUICK_STEP);
        const travelTimeMs = calculateTravelTimeMs(distance, SPY_SPEED, quickStepBonus);

        const departureTime = new Date();
        const arrivalTime = new Date(departureTime.getTime() + travelTimeMs);

        const mission: SpyMission = {
            attackerUsername,
            attackerVillageName,
            defenderUsername,
            defenderVillageName,
            departureTime,
            arrivalTime,
            status: 'in_transit',
        };

        attackerVillage.aliveSpies = Math.max(0, (attackerVillage.aliveSpies ?? 0) - 1);
        await this.dbAccessorService.getCollection(USERS_COLLECTION).updateOne(
            { username: attackerUsername },
            { $set: { [`villages.${attacker.villages.indexOf(attackerVillage)}.aliveSpies`]: attackerVillage.aliveSpies } },
        );

        await this.dbAccessorService.getCollection(SPY_MISSIONS_COLLECTION).insertOne(mission);
        return travelTimeMs;
    }

    async scoutOasis(attackerUsername: string, attackerVillageName: string, oasisId: string): Promise<number> {
        const attacker = await this.dbAccessorService
            .getCollection(USERS_COLLECTION)
            .findOne({ username: attackerUsername }) as User;
        if (!attacker) {
            throw new HttpException("Attacker not found", HttpStatus.NOT_FOUND);
        }

        const oasis = await this.dbAccessorService
            .getCollection(OASES_COLLECTION)
            .findOne({ _id: new ObjectId(oasisId) }) as Oasis;
        if (!oasis) {
            throw new HttpException("Oasis not found", HttpStatus.NOT_FOUND);
        }

        const attackerVillage = attacker.villages.find(v => v.villageName?.trim() === attackerVillageName?.trim());
        if (!attackerVillage) {
            throw new HttpException("Attacker village not found", HttpStatus.NOT_FOUND);
        }

        if (attackerVillage.buildingsLevels.stableLevel <= 0) {
            throw new HttpException("You need a Stable to send spies", HttpStatus.BAD_REQUEST);
        }

        const aliveSpies = attackerVillage.aliveSpies ?? 0;
        if (aliveSpies <= 0) {
            throw new HttpException("No available spies", HttpStatus.BAD_REQUEST);
        }

        const oasisName = oasisTierConfigs[oasis.tier as OasisTier]?.name || 'Oasis';

        const distance = calculateDistance(
            attackerVillage.location.x,
            attackerVillage.location.y,
            oasis.x,
            oasis.y,
        );

        const quickStepBonus = getSkillBonus(attackerVillage.skills, SkillCategory.QUICK_STEP);
        const travelTimeMs = calculateTravelTimeMs(distance, SPY_SPEED, quickStepBonus);

        const departureTime = new Date();
        const arrivalTime = new Date(departureTime.getTime() + travelTimeMs);

        const mission: SpyMission = {
            attackerUsername,
            attackerVillageName,
            defenderUsername: '',
            defenderVillageName: '',
            departureTime,
            arrivalTime,
            status: 'in_transit',
            targetType: 'oasis',
            oasisId: oasisId,
            oasisX: oasis.x,
            oasisY: oasis.y,
            oasisName,
        };

        attackerVillage.aliveSpies = Math.max(0, (attackerVillage.aliveSpies ?? 0) - 1);
        await this.dbAccessorService.getCollection(USERS_COLLECTION).updateOne(
            { username: attackerUsername },
            { $set: { [`villages.${attacker.villages.indexOf(attackerVillage)}.aliveSpies`]: attackerVillage.aliveSpies } },
        );

        await this.dbAccessorService.getCollection(SPY_MISSIONS_COLLECTION).insertOne(mission);
        return travelTimeMs;
    }

    @Cron('*/10 * * * * *')
    async resolveSpyMissions(): Promise<void> {
        await this.serverContextService.forEachServer(async () => {
            const now = new Date();
            const missions = await this.dbAccessorService
                .getCollection(SPY_MISSIONS_COLLECTION)
                .find({ arrivalTime: { $lte: now }, status: { $in: ['in_transit', 'returning'] } })
                .toArray() as SpyMission[];

            for (const mission of missions) {
                try {
                    if (mission.status === 'in_transit') {
                        await this.resolveArrival(mission);
                    } else if (mission.status === 'returning') {
                        await this.completeReturn(mission);
                    }
                } catch (error) {
                    this.logger.error(`Error resolving spy mission ${mission._id}: ${error?.message || error}`);
                }
            }
        });
    }

    private async resolveArrival(mission: SpyMission): Promise<void> {
        if (mission.targetType === 'oasis') {
            await this.resolveOasisArrival(mission);
            return;
        }

        const attacker = await this.dbAccessorService
            .getCollection(USERS_COLLECTION)
            .findOne({ username: mission.attackerUsername }) as User;
        const defender = await this.dbAccessorService
            .getCollection(USERS_COLLECTION)
            .findOne({ username: mission.defenderUsername }) as User;

        if (!attacker || !defender) {
            await this.markMissionCompleted(mission);
            return;
        }

        const attackerVillage = attacker.villages.find(v => v.villageName === mission.attackerVillageName);
        const defenderVillage = defender.villages.find(v => v.villageName === mission.defenderVillageName);

        if (!attackerVillage || !defenderVillage) {
            await this.markMissionCompleted(mission);
            return;
        }

        const wallLevel = defenderVillage.buildingsLevels.wallLevel || 0;
        const stableLevel = defenderVillage.buildingsLevels.stableLevel || 0;
        const silentStealthBonus = getSkillBonus(attackerVillage.skills, SkillCategory.SILENT_STEALTH);

        const detectionChance = getDetectionChance(wallLevel, stableLevel, silentStealthBonus);
        const roll = Math.random() * 100;

        const collection = this.dbAccessorService.getCollection(SPY_MISSIONS_COLLECTION);

        if (roll < detectionChance) {
            attackerVillage.spyDeathTimestamps = attackerVillage.spyDeathTimestamps || [];
            attackerVillage.spyDeathTimestamps.push(new Date());

            const villageIdx = attacker.villages.findIndex(v => v.villageName === mission.attackerVillageName);
            if (villageIdx >= 0) {
                await this.dbAccessorService.getCollection(USERS_COLLECTION).updateOne(
                    { username: attacker.username },
                    { $set: { [`villages.${villageIdx}.spyDeathTimestamps`]: attackerVillage.spyDeathTimestamps } },
                );
            }

            await collection.updateOne(
                { _id: mission._id },
                { $set: { status: 'caught' as const } },
            );

            await this.createCaughtReport(
                attackerVillage, defenderVillage,
                attacker.username, defender.username,
            );
        } else {
            await this.createSpyReport(attackerVillage, defenderVillage, attacker.username, defender.username);

            attacker.totalStats = attacker.totalStats || { lifetimeBossDamage: 0, lifetimeResourcesStolen: 0, totalBattlesWon: 0, successfulSpies: 0, relicsStolen: 0, resourcesSentToClan: 0, mythicBossDamage: 0, supportTroopsSent: 0, oasesConquered: 0 };
            attacker.totalStats.successfulSpies = (attacker.totalStats.successfulSpies || 0) + 1;
            await this.dbAccessorService.getCollection(USERS_COLLECTION).updateOne(
                { username: attacker.username },
                { $set: { 'totalStats.successfulSpies': attacker.totalStats.successfulSpies } },
            );

            this.dailyQuestService.incrementProgress(attacker.username, DailyQuestTrackingType.SUCCESSFUL_SPIES, 1).catch(() => {});
            if (attacker.clanName) {
                this.clanQuestService.incrementClanProgress(attacker.clanName, attacker.username, ClanQuestTrackingType.TOTAL_SUCCESSFUL_SPIES, 1).catch(() => {});
            }

            const distance = calculateDistance(
                attackerVillage.location.x,
                attackerVillage.location.y,
                defenderVillage.location.x,
                defenderVillage.location.y,
            );
            const quickStepBonus = getSkillBonus(attackerVillage.skills, SkillCategory.QUICK_STEP);
            const travelTimeMs = calculateTravelTimeMs(distance, SPY_SPEED, quickStepBonus);
            const departureTime = new Date();
            const returnArrival = new Date(departureTime.getTime() + travelTimeMs);

            await collection.updateOne(
                { _id: mission._id },
                {
                    $set: {
                        status: 'returning' as const,
                        departureTime,
                        arrivalTime: returnArrival,
                    },
                },
            );
        }
    }

    private async resolveOasisArrival(mission: SpyMission): Promise<void> {
        const attacker = await this.dbAccessorService
            .getCollection(USERS_COLLECTION)
            .findOne({ username: mission.attackerUsername }) as User;
        if (!attacker) {
            await this.markMissionCompleted(mission);
            return;
        }

        const attackerVillage = attacker.villages.find(v => v.villageName === mission.attackerVillageName);
        if (!attackerVillage) {
            await this.markMissionCompleted(mission);
            return;
        }

        const oasis = await this.dbAccessorService
            .getCollection(OASES_COLLECTION)
            .findOne({ _id: new ObjectId(mission.oasisId) }) as Oasis;

        if (!oasis) {
            await this.createOasisGoneCaughtReport(attackerVillage, attacker.username, mission);
            await this.markMissionCompleted(mission);
            return;
        }

        const collection = this.dbAccessorService.getCollection(SPY_MISSIONS_COLLECTION);
        const isOccupied = !!oasis.garrison;

        let detected = false;
        if (isOccupied) {
            const silentStealthBonus = getSkillBonus(attackerVillage.skills, SkillCategory.SILENT_STEALTH);
            const detectionChance = Math.max(5, 25 - silentStealthBonus);
            detected = Math.random() * 100 < detectionChance;
        }

        if (detected) {
            attackerVillage.spyDeathTimestamps = attackerVillage.spyDeathTimestamps || [];
            attackerVillage.spyDeathTimestamps.push(new Date());

            const villageIdx = attacker.villages.findIndex(v => v.villageName === mission.attackerVillageName);
            if (villageIdx >= 0) {
                await this.dbAccessorService.getCollection(USERS_COLLECTION).updateOne(
                    { username: attacker.username },
                    { $set: { [`villages.${villageIdx}.spyDeathTimestamps`]: attackerVillage.spyDeathTimestamps } },
                );
            }

            await collection.updateOne(
                { _id: mission._id },
                { $set: { status: 'caught' as const } },
            );

            await this.createOasisCaughtReport(attackerVillage, attacker.username, mission, oasis);
        } else {
            await this.createOasisSpyReport(attackerVillage, attacker.username, mission, oasis);

            attacker.totalStats = attacker.totalStats || { lifetimeBossDamage: 0, lifetimeResourcesStolen: 0, totalBattlesWon: 0, successfulSpies: 0, relicsStolen: 0, resourcesSentToClan: 0, mythicBossDamage: 0, supportTroopsSent: 0, oasesConquered: 0 };
            attacker.totalStats.successfulSpies = (attacker.totalStats.successfulSpies || 0) + 1;
            await this.dbAccessorService.getCollection(USERS_COLLECTION).updateOne(
                { username: attacker.username },
                { $set: { 'totalStats.successfulSpies': attacker.totalStats.successfulSpies } },
            );

            this.dailyQuestService.incrementProgress(attacker.username, DailyQuestTrackingType.SUCCESSFUL_SPIES, 1)
                .then(() => this.dailyQuestService.incrementProgress(attacker.username, DailyQuestTrackingType.SPY_OASIS, 1))
                .catch(() => {});
            if (attacker.clanName) {
                this.clanQuestService.incrementClanProgress(attacker.clanName, attacker.username, ClanQuestTrackingType.TOTAL_SUCCESSFUL_SPIES, 1)
                    .then(() => this.clanQuestService.incrementClanProgress(attacker.clanName, attacker.username, ClanQuestTrackingType.TOTAL_OASIS_SPIES, 1))
                    .catch(() => {});
            }

            const distance = calculateDistance(
                attackerVillage.location.x,
                attackerVillage.location.y,
                oasis.x,
                oasis.y,
            );
            const quickStepBonus = getSkillBonus(attackerVillage.skills, SkillCategory.QUICK_STEP);
            const travelTimeMs = calculateTravelTimeMs(distance, SPY_SPEED, quickStepBonus);
            const departureTime = new Date();
            const returnArrival = new Date(departureTime.getTime() + travelTimeMs);

            await collection.updateOne(
                { _id: mission._id },
                {
                    $set: {
                        status: 'returning' as const,
                        departureTime,
                        arrivalTime: returnArrival,
                    },
                },
            );
        }
    }

    private async completeReturn(mission: SpyMission): Promise<void> {
        await this.dbAccessorService
            .getCollection(SPY_MISSIONS_COLLECTION)
            .updateOne(
                { _id: mission._id },
                { $set: { status: 'completed' as const } },
            );

        const attacker = await this.dbAccessorService
            .getCollection(USERS_COLLECTION)
            .findOne({ username: mission.attackerUsername }) as User;
        if (attacker) {
            const villageIdx = attacker.villages.findIndex(v => v.villageName === mission.attackerVillageName);
            if (villageIdx >= 0) {
                const village = attacker.villages[villageIdx];
                const maxSpies = getMaxSpies(village.buildingsLevels?.stableLevel || 0);
                const newAlive = Math.min(maxSpies, (village.aliveSpies ?? 0) + 1);
                await this.dbAccessorService.getCollection(USERS_COLLECTION).updateOne(
                    { username: mission.attackerUsername },
                    { $set: { [`villages.${villageIdx}.aliveSpies`]: newAlive } },
                );
            }
        }
    }

    private async markMissionCompleted(mission: SpyMission): Promise<void> {
        await this.dbAccessorService
            .getCollection(SPY_MISSIONS_COLLECTION)
            .updateOne(
                { _id: mission._id },
                { $set: { status: 'completed' as const } },
            );
    }

    private async createCaughtReport(attackerVillage: Village, defenderVillage: Village, attackerName: string, defenderName: string): Promise<void> {
        const emptyTroops = new TroopsAmounts(0, 0, 0, 0, 0, 0, 0);
        const emptyResources = new ResourcesAmounts(0, 0, 0);

        const report = new AttackReport(
            attackerName,
            attackerVillage.villageName,
            defenderName,
            defenderVillage.villageName,
            new Date(),
            false,
            emptyResources,
            0, 0, 0, 0, 0,
            emptyTroops, emptyTroops,
            emptyTroops, emptyTroops,
            emptyTroops, emptyTroops,
            'spy',
        );
        report.attackerVillageX = attackerVillage.location.x;
        report.attackerVillageY = attackerVillage.location.y;
        report.defenderVillageX = defenderVillage.location.x;
        report.defenderVillageY = defenderVillage.location.y;

        await this.reportsService.saveAttackReport(report);
    }

    private async createSpyReport(attackerVillage: Village, defenderVillage: Village, attackerName: string, defenderName: string): Promise<void> {
        const defenderResources = defenderVillage.resourcesAmounts;
        const defenderTroops = defenderVillage.troops;
        const supportTroops = defenderVillage.clanTroops;

        const attackerTroops = new TroopsAmounts(0, 0, 0, 0, 0, 0, 0);
        const lostTroops = new TroopsAmounts(0, 0, 0, 0, 0, 0, 0);

        const lootedResources = new ResourcesAmounts(0, 0, 0);

        const report = new AttackReport(
            attackerName,
            attackerVillage.villageName,
            defenderName,
            defenderVillage.villageName,
            new Date(),
            true,
            lootedResources,
            0,
            0,
            0,
            0,
            0,
            attackerTroops,
            lostTroops,
            defenderTroops,
            new TroopsAmounts(0, 0, 0, 0, 0, 0, 0),
            supportTroops,
            new TroopsAmounts(0, 0, 0, 0, 0, 0, 0),
            'spy',
        );
        report.attackerVillageX = attackerVillage.location.x;
        report.attackerVillageY = attackerVillage.location.y;
        report.defenderVillageX = defenderVillage.location.x;
        report.defenderVillageY = defenderVillage.location.y;

        await this.reportsService.saveAttackReport(report);
    }

    private async createOasisSpyReport(attackerVillage: Village, attackerName: string, mission: SpyMission, oasis: Oasis): Promise<void> {
        const emptyTroops = new TroopsAmounts(0, 0, 0, 0, 0, 0, 0);
        const lootedResources = new ResourcesAmounts(0, 0, 0);

        const ownerUsername = oasis.garrison?.username || '';
        const oasisName = mission.oasisName || 'Oasis';

        let garrisonTroops = emptyTroops;
        if (oasis.garrison) {
            const total = getTotalGarrisonTroops(oasis.garrison);
            garrisonTroops = new TroopsAmounts(
                total.spearFighters, total.swordFighters, total.axeFighters,
                total.archers, total.magicians, total.horsemen, total.catapults,
            );
        }

        const report = new AttackReport(
            attackerName,
            attackerVillage.villageName,
            ownerUsername,
            oasisName,
            new Date(),
            true,
            lootedResources,
            0, 0, 0, 0, 0,
            emptyTroops, emptyTroops,
            garrisonTroops,
            emptyTroops,
            emptyTroops,
            emptyTroops,
            'oasis_spy',
        );
        report.attackerVillageX = attackerVillage.location.x;
        report.attackerVillageY = attackerVillage.location.y;
        report.oasisId = oasis._id?.toHexString();
        report.oasisName = oasisName;
        report.oasisX = oasis.x;
        report.oasisY = oasis.y;
        report.oasisResources = {
            wood: Math.floor(oasis.resourcesRemaining?.wood || 0),
            stone: Math.floor(oasis.resourcesRemaining?.stone || 0),
            crop: Math.floor(oasis.resourcesRemaining?.crop || 0),
        };

        await this.reportsService.saveAttackReport(report);
    }

    private async createOasisCaughtReport(attackerVillage: Village, attackerName: string, mission: SpyMission, oasis: Oasis): Promise<void> {
        const emptyTroops = new TroopsAmounts(0, 0, 0, 0, 0, 0, 0);
        const emptyResources = new ResourcesAmounts(0, 0, 0);
        const oasisName = mission.oasisName || 'Oasis';

        const report = new AttackReport(
            attackerName,
            attackerVillage.villageName,
            oasis.garrison?.username || '',
            oasisName,
            new Date(),
            false,
            emptyResources,
            0, 0, 0, 0, 0,
            emptyTroops, emptyTroops,
            emptyTroops, emptyTroops,
            emptyTroops, emptyTroops,
            'oasis_spy',
        );
        report.attackerVillageX = attackerVillage.location.x;
        report.attackerVillageY = attackerVillage.location.y;
        report.oasisId = oasis._id?.toHexString();
        report.oasisName = oasisName;
        report.oasisX = oasis.x;
        report.oasisY = oasis.y;

        await this.reportsService.saveAttackReport(report);
    }

    private async createOasisGoneCaughtReport(attackerVillage: Village, attackerName: string, mission: SpyMission): Promise<void> {
        const emptyTroops = new TroopsAmounts(0, 0, 0, 0, 0, 0, 0);
        const emptyResources = new ResourcesAmounts(0, 0, 0);
        const oasisName = mission.oasisName || 'Oasis';

        const report = new AttackReport(
            attackerName,
            attackerVillage.villageName,
            '',
            oasisName,
            new Date(),
            false,
            emptyResources,
            0, 0, 0, 0, 0,
            emptyTroops, emptyTroops,
            emptyTroops, emptyTroops,
            emptyTroops, emptyTroops,
            'oasis_spy',
        );
        report.attackerVillageX = attackerVillage.location.x;
        report.attackerVillageY = attackerVillage.location.y;
        report.oasisName = oasisName;

        await this.reportsService.saveAttackReport(report);
    }

    @Cron('*/30 * * * * *')
    async regenerateSpies(): Promise<void> {
        await this.serverContextService.forEachServer(async () => {
            const users = await this.dbAccessorService
                .getCollection(USERS_COLLECTION)
                .find({})
                .toArray() as User[];

            const activeMissions = await this.dbAccessorService
                .getCollection(SPY_MISSIONS_COLLECTION)
                .find({ status: { $in: ['in_transit', 'returning'] } })
                .toArray() as SpyMission[];

            const missionsPerVillage = new Map<string, number>();
            for (const m of activeMissions) {
                const key = `${m.attackerUsername}::${m.attackerVillageName}`;
                missionsPerVillage.set(key, (missionsPerVillage.get(key) || 0) + 1);
            }

            const now = new Date();

            for (const user of users) {
                let updated = false;

                for (const village of user.villages) {
                    const stableLevel = village.buildingsLevels.stableLevel || 0;
                    const maxSpies = getMaxSpies(stableLevel);

                    if (!maxSpies || maxSpies <= 0) continue;

                    village.aliveSpies = village.aliveSpies ?? maxSpies;
                    village.spyDeathTimestamps = village.spyDeathTimestamps || [];

                    const key = `${user.username}::${village.villageName}`;
                    const onMission = missionsPerVillage.get(key) || 0;

                    if (village.aliveSpies < maxSpies && village.spyDeathTimestamps.length === 0 && onMission === 0) {
                        village.aliveSpies = maxSpies;
                        updated = true;
                    }

                    while (village.aliveSpies + onMission < maxSpies && village.spyDeathTimestamps.length > 0) {
                        const oldest = village.spyDeathTimestamps[0];
                        const regenReady = new Date(oldest.getTime() + (12 * 60 * 60 * 1000));
                        if (regenReady <= now) {
                            village.aliveSpies += 1;
                            village.spyDeathTimestamps.shift();
                            updated = true;
                        } else {
                            break;
                        }
                    }
                }

                if (updated) {
                    await this.dbAccessorService
                        .getCollection(USERS_COLLECTION)
                        .updateOne({ username: user.username }, { $set: user });
                }
            }
        });
    }
}


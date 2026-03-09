import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ObjectId } from 'mongodb';
import { DbAccessorService } from '../database/services/db-accessor.service';
import { ServerContextService } from '../database/services/server-context.service';
import { ReportsService } from '../reports/services/reports/reports.service';
import { MessagesService } from '../messages/services/messages.service';
import { User } from '../user/models/user.entity';
import { Village } from '../user/models/village.entity';
import { ResourcesAmounts } from '../user/models/resourcesAmounts';
import { TroopsAmounts } from '../user/models/troopsAmounts';
import { AttackReport } from '../reports/models/attackReport.entity';
import { ExpertSpyMission } from './models/expertSpyMission.entity';
import { CrowMessage } from './models/crowMessage.entity';
import { Oasis } from '../oasis/models/oasis.entity';
import {
    SPY_SPEED,
    EMPTY_SKILLS,
    calculateDistance,
    calculateTravelTimeMs,
    getSkillBonus,
    SkillCategory,
    getDetectionChance,
} from 'utils';

const EXPERT_SPY_UNLOCK_STABLE_LEVEL = 5;
const EXPERT_SPY_EMBED_DURATION_MS = 6 * 60 * 60 * 1000;
const EXPERT_SPY_DEATH_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const CROW_SPEED_TILES_PER_MIN = 20;

const USERS_COLLECTION = 'users';
const EXPERT_SPY_MISSIONS_COLLECTION = 'expertSpyMissions';
const CROW_MESSAGES_COLLECTION = 'crowMessages';
const OASES_COLLECTION = 'oases';

@Injectable()
export class ExpertSpyService {
    private readonly logger = new Logger(ExpertSpyService.name);

    constructor(
        private dbAccessorService: DbAccessorService,
        private serverContextService: ServerContextService,
        private reportsService: ReportsService,
        private messagesService: MessagesService,
    ) {}

    async deployExpertSpy(
        username: string,
        villageName: string,
        targetUsername: string | undefined,
        targetVillageName: string | undefined,
        targetType: 'village' | 'oasis',
        targetOasisId?: string,
    ): Promise<number> {
        const user = await this.dbAccessorService
            .getCollection(USERS_COLLECTION)
            .findOne({ username }) as User | null;

        if (!user) {
            throw new HttpException('User not found', HttpStatus.NOT_FOUND);
        }

        const village = user.villages.find((v) => v.villageName?.trim() === villageName?.trim());
        if (!village) {
            throw new HttpException('Village not found', HttpStatus.NOT_FOUND);
        }

        const stableLevel = village.buildingsLevels?.stableLevel ?? 0;
        if (stableLevel < EXPERT_SPY_UNLOCK_STABLE_LEVEL) {
            throw new HttpException(
                `Expert Spy requires Stable level ${EXPERT_SPY_UNLOCK_STABLE_LEVEL}`,
                HttpStatus.BAD_REQUEST,
            );
        }

        const now = new Date();
        const activeMission = await this.dbAccessorService
            .getCollection(EXPERT_SPY_MISSIONS_COLLECTION)
            .findOne({
                ownerUsername: username,
                ownerVillageName: villageName,
                status: { $in: ['deploying', 'embedded', 'returning'] },
            }) as ExpertSpyMission | null;

        if (activeMission) {
            throw new HttpException('Expert spy is already deployed', HttpStatus.BAD_REQUEST);
        }

        const recentCaught = await this.dbAccessorService
            .getCollection(EXPERT_SPY_MISSIONS_COLLECTION)
            .findOne({
                ownerUsername: username,
                ownerVillageName: villageName,
                status: 'caught',
                deathCooldownUntil: { $gt: now },
            }) as ExpertSpyMission | null;

        if (recentCaught) {
            throw new HttpException(
                'Expert spy is on death cooldown',
                HttpStatus.BAD_REQUEST,
            );
        }

        let targetX: number;
        let targetY: number;

        if (targetType === 'village') {
            if (!targetUsername || !targetVillageName) {
                throw new HttpException('Target village required', HttpStatus.BAD_REQUEST);
            }
            if (username === targetUsername) {
                throw new HttpException('Cannot deploy to your own village', HttpStatus.BAD_REQUEST);
            }

            const targetUser = await this.dbAccessorService
                .getCollection(USERS_COLLECTION)
                .findOne({ username: targetUsername }) as User | null;
            if (!targetUser) {
                throw new HttpException('Target user not found', HttpStatus.NOT_FOUND);
            }
            const targetVillage = targetUser.villages.find((v) => v.villageName === targetVillageName);
            if (!targetVillage) {
                throw new HttpException('Target village not found', HttpStatus.NOT_FOUND);
            }
            targetX = targetVillage.location.x;
            targetY = targetVillage.location.y;
        } else {
            if (!targetOasisId) {
                throw new HttpException('Target oasis ID required', HttpStatus.BAD_REQUEST);
            }
            const oasis = await this.dbAccessorService
                .getCollection(OASES_COLLECTION)
                .findOne({ _id: new ObjectId(targetOasisId) }) as Oasis | null;
            if (!oasis) {
                throw new HttpException('Target oasis not found', HttpStatus.NOT_FOUND);
            }
            targetX = oasis.x;
            targetY = oasis.y;
        }

        const distance = calculateDistance(
            village.location.x,
            village.location.y,
            targetX,
            targetY,
        );
        const quickStepBonus = getSkillBonus(village.skills ?? EMPTY_SKILLS, SkillCategory.QUICK_STEP);
        const travelTimeMs = calculateTravelTimeMs(distance, SPY_SPEED, quickStepBonus);
        const arrivalTime = new Date(now.getTime() + travelTimeMs);

        const mission: ExpertSpyMission = {
            ownerUsername: username,
            ownerVillageName: villageName,
            targetUsername,
            targetVillageName,
            targetType,
            targetOasisId,
            status: 'deploying',
            deployedAt: now,
            arrivalTime,
        };

        await this.dbAccessorService
            .getCollection(EXPERT_SPY_MISSIONS_COLLECTION)
            .insertOne(mission);

        return travelTimeMs;
    }

    @Cron('*/10 * * * * *')
    async resolveExpertSpyMissions(): Promise<void> {
        await this.serverContextService.forEachServer(async () => {
            const now = new Date();
            const missions = await this.dbAccessorService
                .getCollection(EXPERT_SPY_MISSIONS_COLLECTION)
                .find({
                    status: { $in: ['deploying', 'embedded', 'returning'] },
                })
                .toArray() as ExpertSpyMission[];

            for (const mission of missions) {
                try {
                    if (mission.status === 'deploying' && mission.arrivalTime <= now) {
                        await this.resolveDeployingArrival(mission);
                    } else if (mission.status === 'embedded' && mission.embedExpiresAt && mission.embedExpiresAt <= now) {
                        await this.startReturn(mission);
                    } else if (mission.status === 'returning' && mission.arrivalTime <= now) {
                        await this.completeReturn(mission);
                    }
                } catch (error) {
                    this.logger.error(
                        `Error resolving expert spy mission ${mission._id}: ${(error as Error)?.message || error}`,
                    );
                }
            }
        });
    }

    private async resolveDeployingArrival(mission: ExpertSpyMission): Promise<void> {
        const owner = await this.dbAccessorService
            .getCollection(USERS_COLLECTION)
            .findOne({ username: mission.ownerUsername }) as User | null;

        if (!owner) {
            await this.markMissionCompleted(mission);
            return;
        }

        const ownerVillage = owner.villages.find((v) => v.villageName === mission.ownerVillageName);
        if (!ownerVillage) {
            await this.markMissionCompleted(mission);
            return;
        }

        let caught = false;
        let wallLevel = 0;
        let stableLevel = 0;
        let defenderUsername = '';
        let defenderVillageName = '';
        let defenderVillage: Village | null = null;

        if (mission.targetType === 'village' && mission.targetUsername && mission.targetVillageName) {
            const defender = await this.dbAccessorService
                .getCollection(USERS_COLLECTION)
                .findOne({ username: mission.targetUsername }) as User | null;
            if (!defender) {
                await this.markMissionCompleted(mission);
                return;
            }
            defenderVillage = defender.villages.find((v) => v.villageName === mission.targetVillageName) ?? null;
            if (!defenderVillage) {
                await this.markMissionCompleted(mission);
                return;
            }
            wallLevel = defenderVillage.buildingsLevels?.wallLevel ?? 0;
            stableLevel = defenderVillage.buildingsLevels?.stableLevel ?? 0;
            defenderUsername = mission.targetUsername;
            defenderVillageName = mission.targetVillageName;

            const silentStealthBonus = getSkillBonus(ownerVillage.skills ?? EMPTY_SKILLS, SkillCategory.SILENT_STEALTH);
            const detectionChance = getDetectionChance(wallLevel, stableLevel, silentStealthBonus);
            const roll = Math.random() * 100;
            caught = roll < detectionChance;
        } else if (mission.targetType === 'oasis' && mission.targetOasisId) {
            const oasis = await this.dbAccessorService
                .getCollection(OASES_COLLECTION)
                .findOne({ _id: new ObjectId(mission.targetOasisId) }) as Oasis | null;
            if (!oasis) {
                await this.markMissionCompleted(mission);
                return;
            }
            if (!oasis.garrison) {
                caught = false;
            } else {
                const silentStealthBonus = getSkillBonus(ownerVillage.skills ?? EMPTY_SKILLS, SkillCategory.SILENT_STEALTH);
                const detectionChance = getDetectionChance(0, 0, silentStealthBonus);
                const roll = Math.random() * 100;
                caught = roll < detectionChance;
                defenderUsername = oasis.garrison.username;
                defenderVillageName = oasis.garrison.villageName;
            }
        }

        const collection = this.dbAccessorService.getCollection(EXPERT_SPY_MISSIONS_COLLECTION);

        if (caught) {
            const deathCooldownUntil = new Date(Date.now() + EXPERT_SPY_DEATH_COOLDOWN_MS);
            await collection.updateOne(
                { _id: mission._id },
                { $set: { status: 'caught' as const, deathCooldownUntil } },
            );

            const emptyTroops = new TroopsAmounts(0, 0, 0, 0, 0, 0, 0);
            const emptyResources = new ResourcesAmounts(0, 0, 0);
            const report = new AttackReport(
                mission.ownerUsername,
                mission.ownerVillageName,
                defenderUsername,
                defenderVillageName,
                new Date(),
                false,
                emptyResources,
                0, 0, 0, 0, 0,
                emptyTroops,
                emptyTroops,
                emptyTroops,
                emptyTroops,
                emptyTroops,
                emptyTroops,
                'spy',
            );
            await this.reportsService.saveAttackReport(report);
        } else {
            const embedExpiresAt = new Date(Date.now() + EXPERT_SPY_EMBED_DURATION_MS);
            await collection.updateOne(
                { _id: mission._id },
                { $set: { status: 'embedded' as const, embedExpiresAt } },
            );
        }
    }

    private async startReturn(mission: ExpertSpyMission): Promise<void> {
        const owner = await this.dbAccessorService
            .getCollection(USERS_COLLECTION)
            .findOne({ username: mission.ownerUsername }) as User | null;
        if (!owner) {
            await this.markMissionCompleted(mission);
            return;
        }

        const ownerVillage = owner.villages.find((v) => v.villageName === mission.ownerVillageName);
        if (!ownerVillage) {
            await this.markMissionCompleted(mission);
            return;
        }

        let targetX: number;
        let targetY: number;

        if (mission.targetType === 'village' && mission.targetUsername && mission.targetVillageName) {
            const targetUser = await this.dbAccessorService
                .getCollection(USERS_COLLECTION)
                .findOne({ username: mission.targetUsername }) as User | null;
            const targetVillage = targetUser?.villages.find((v) => v.villageName === mission.targetVillageName);
            if (!targetVillage) {
                await this.markMissionCompleted(mission);
                return;
            }
            targetX = targetVillage.location.x;
            targetY = targetVillage.location.y;
        } else if (mission.targetType === 'oasis' && mission.targetOasisId) {
            const oasis = await this.dbAccessorService
                .getCollection(OASES_COLLECTION)
                .findOne({ _id: new ObjectId(mission.targetOasisId) }) as Oasis | null;
            if (!oasis) {
                await this.markMissionCompleted(mission);
                return;
            }
            targetX = oasis.x;
            targetY = oasis.y;
        } else {
            await this.markMissionCompleted(mission);
            return;
        }

        const distance = calculateDistance(
            ownerVillage.location.x,
            ownerVillage.location.y,
            targetX,
            targetY,
        );
        const quickStepBonus = getSkillBonus(ownerVillage.skills ?? EMPTY_SKILLS, SkillCategory.QUICK_STEP);
        const travelTimeMs = calculateTravelTimeMs(distance, SPY_SPEED, quickStepBonus);
        const arrivalTime = new Date(Date.now() + travelTimeMs);

        await this.dbAccessorService
            .getCollection(EXPERT_SPY_MISSIONS_COLLECTION)
            .updateOne(
                { _id: mission._id },
                { $set: { status: 'returning' as const, arrivalTime } },
            );
    }

    private async completeReturn(mission: ExpertSpyMission): Promise<void> {
        await this.dbAccessorService
            .getCollection(EXPERT_SPY_MISSIONS_COLLECTION)
            .updateOne(
                { _id: mission._id },
                { $set: { status: 'completed' as const } },
            );
    }

    private async markMissionCompleted(mission: ExpertSpyMission): Promise<void> {
        await this.dbAccessorService
            .getCollection(EXPERT_SPY_MISSIONS_COLLECTION)
            .updateOne(
                { _id: mission._id },
                { $set: { status: 'completed' as const } },
            );
    }

    async dispatchCrow(mission: ExpertSpyMission, content: string): Promise<void> {
        const owner = await this.dbAccessorService
            .getCollection(USERS_COLLECTION)
            .findOne({ username: mission.ownerUsername }) as User | null;
        if (!owner) return;

        const ownerVillage = owner.villages.find((v) => v.villageName === mission.ownerVillageName);
        if (!ownerVillage) return;

        let targetX: number;
        let targetY: number;

        if (mission.targetType === 'village' && mission.targetUsername && mission.targetVillageName) {
            const targetUser = await this.dbAccessorService
                .getCollection(USERS_COLLECTION)
                .findOne({ username: mission.targetUsername }) as User | null;
            const targetVillage = targetUser?.villages.find((v) => v.villageName === mission.targetVillageName);
            if (!targetVillage) return;
            targetX = targetVillage.location.x;
            targetY = targetVillage.location.y;
        } else if (mission.targetType === 'oasis' && mission.targetOasisId) {
            const oasis = await this.dbAccessorService
                .getCollection(OASES_COLLECTION)
                .findOne({ _id: new ObjectId(mission.targetOasisId) }) as Oasis | null;
            if (!oasis) return;
            targetX = oasis.x;
            targetY = oasis.y;
        } else {
            return;
        }

        const distance = calculateDistance(
            targetX,
            targetY,
            ownerVillage.location.x,
            ownerVillage.location.y,
        );
        const travelTimeMs = calculateTravelTimeMs(distance, CROW_SPEED_TILES_PER_MIN, 0);
        const departureTime = new Date();
        const arrivalTime = new Date(departureTime.getTime() + travelTimeMs);

        const crowMessage: CrowMessage = {
            ownerUsername: mission.ownerUsername,
            ownerVillageName: mission.ownerVillageName,
            missionId: mission._id!,
            content,
            departureTime,
            arrivalTime,
            status: 'in_transit',
        };

        await this.dbAccessorService
            .getCollection(CROW_MESSAGES_COLLECTION)
            .insertOne(crowMessage);
    }

    @Cron('*/10 * * * * *')
    async deliverCrows(): Promise<void> {
        await this.serverContextService.forEachServer(async () => {
            const now = new Date();
            const crows = await this.dbAccessorService
                .getCollection(CROW_MESSAGES_COLLECTION)
                .find({
                    status: 'in_transit',
                    arrivalTime: { $lte: now },
                })
                .toArray() as CrowMessage[];

            for (const crow of crows) {
                try {
                    await this.messagesService.sendClanNotificationMessage(
                        crow.ownerUsername,
                        'Crow Report',
                        crow.content,
                    );
                    await this.dbAccessorService
                        .getCollection(CROW_MESSAGES_COLLECTION)
                        .updateOne(
                            { _id: crow._id },
                            { $set: { status: 'delivered' as const } },
                        );
                } catch (error) {
                    this.logger.error(
                        `Error delivering crow ${crow._id}: ${(error as Error)?.message || error}`,
                    );
                }
            }
        });
    }

    async getExpertSpyStatus(username: string, villageName: string): Promise<{
        status: 'available' | 'deployed' | 'dead';
        targetUsername?: string;
        targetVillageName?: string;
        targetType?: 'village' | 'oasis';
        targetOasisId?: string;
        deployedAt?: Date;
        embedExpiresAt?: Date;
        deathCooldownUntil?: Date;
    }> {
        const now = new Date();

        const activeMission = await this.dbAccessorService
            .getCollection(EXPERT_SPY_MISSIONS_COLLECTION)
            .findOne({
                ownerUsername: username,
                ownerVillageName: villageName,
                status: { $in: ['deploying', 'embedded', 'returning'] },
            }) as ExpertSpyMission | null;

        if (activeMission) {
            return {
                status: 'deployed',
                targetUsername: activeMission.targetUsername,
                targetVillageName: activeMission.targetVillageName,
                targetType: activeMission.targetType,
                targetOasisId: activeMission.targetOasisId,
                deployedAt: activeMission.deployedAt,
                embedExpiresAt: activeMission.embedExpiresAt,
            };
        }

        const caughtMission = await this.dbAccessorService
            .getCollection(EXPERT_SPY_MISSIONS_COLLECTION)
            .findOne({
                ownerUsername: username,
                ownerVillageName: villageName,
                status: 'caught',
                deathCooldownUntil: { $gt: now },
            }) as ExpertSpyMission | null;

        if (caughtMission) {
            return {
                status: 'dead',
                deathCooldownUntil: caughtMission.deathCooldownUntil,
            };
        }

        return { status: 'available' };
    }

    async onEventAtTarget(
        targetUsername: string | undefined,
        targetVillageName: string | undefined,
        targetOasisId: string | undefined,
        eventDescription: string,
    ): Promise<void> {
        const query: Record<string, unknown> = {
            status: 'embedded',
        };

        if (targetUsername !== undefined && targetVillageName !== undefined) {
            query.targetType = 'village';
            query.targetUsername = targetUsername;
            query.targetVillageName = targetVillageName;
        } else if (targetOasisId !== undefined) {
            query.targetType = 'oasis';
            query.targetOasisId = targetOasisId;
        } else {
            return;
        }

        const missions = await this.dbAccessorService
            .getCollection(EXPERT_SPY_MISSIONS_COLLECTION)
            .find(query)
            .toArray() as ExpertSpyMission[];

        for (const mission of missions) {
            await this.dispatchCrow(mission, eventDescription);
        }
    }
}

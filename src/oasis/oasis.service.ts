import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ObjectId } from 'mongodb';
import {
    OasisTier,
    oasisTierConfigs,
    generateOasisResources,
    selectRandomOasisTier,
    getMaxOasesOnMap,
    OASIS_SPAWN_CHANCE,
    OASIS_HARVEST_RATE_PER_TROOP_PER_HOUR,
    OASIS_UNCLAIMED_DESPAWN_MS,
    OASIS_PROXIMITY_RANGE,
    calculateDistance,
    getArmySpeed,
    calculateTravelTimeMs,
    getSkillBonus,
    SkillCategory,
    warehouseStorageByLevel,
    spearFighterAttackingStat,
    swordFighterAttackingStat,
    axeFighterAttackingStat,
    archerAttackingStat,
    magicianAttackingStat,
    horsemenAttackingStat,
    catapultsAttackingStat,
    spearFighterDefenceStat,
    swordFighterDefenceStat,
    axeFighterDefenceStat,
    archerDefenceStat,
    magicianDefenceStat,
    horsemenDefenceStat,
    catapultsDefenceStat,
} from 'utils';
import { DbAccessorService } from '../database/services/db-accessor.service';
import { ServerContextService } from '../database/services/server-context.service';
import { ReportsService } from '../reports/services/reports/reports.service';
import { MessagesService } from '../messages/services/messages.service';
import { User } from '../user/models/user.entity';
import { TroopsAmounts } from '../user/models/troopsAmounts';
import { ResourcesAmounts } from '../user/models/resourcesAmounts';
import { AttackReport } from '../reports/models/attackReport.entity';
import { DailyQuestTrackingType, ClanQuestTrackingType } from 'utils';
import { DailyQuestService } from '../dailyQuests/daily-quest.service';
import { ClanQuestService } from '../clanQuests/clan-quest.service';
import { unlockAchievements } from '../user/services/achievement-utils';
import { Oasis, OasisGarrison, OasisGarrisonContribution, getGarrisonContributions, getTotalGarrisonTroops, getTotalTroopCount } from './models/oasis.entity';

const OASES_COLLECTION = 'oases';
const USERS_COLLECTION = 'users';
const MOVEMENTS_COLLECTION = 'movements';
const GRIDS_COLLECTION = 'grids';
const BOSSES_COLLECTION = 'bosses';
const WORLD_SIZE = 100;

@Injectable()
export class OasisService {
    private readonly logger = new Logger(OasisService.name);

    constructor(
        private dbAccessorService: DbAccessorService,
        private serverContextService: ServerContextService,
        private reportsService: ReportsService,
        private messagesService: MessagesService,
        private dailyQuestService: DailyQuestService,
        private clanQuestService: ClanQuestService,
    ) {}

    @Cron('0 */30 * * * *')
    async trySpawnOasis(): Promise<void> {
        await this.serverContextService.forEachServer(async () => {
            try {
                await this.cleanupUnclaimedOases();

                const playerCount = await this.dbAccessorService
                    .getCollection(USERS_COLLECTION)
                    .countDocuments({ isDeleted: { $ne: true } });
                const maxOases = getMaxOasesOnMap(playerCount);

                const currentOasisCount = await this.dbAccessorService
                    .getCollection(OASES_COLLECTION)
                    .countDocuments({});

                if (currentOasisCount >= maxOases) {
                    this.logger.log(
                        `Oasis cap reached (${currentOasisCount}/${maxOases}), skipping spawn`,
                    );
                    return;
                }

                if (Math.random() > OASIS_SPAWN_CHANCE) {
                    this.logger.log('Oasis spawn chance missed this interval');
                    return;
                }

                const tier = selectRandomOasisTier();
                const location = await this.findSpawnLocation();

                if (!location) {
                    this.logger.warn('Could not find valid spawn location for oasis');
                    return;
                }

                await this.spawnOasis(tier, location.x, location.y);
                this.logger.log(`Spawned ${tier} oasis at (${location.x}, ${location.y})`);
            } catch (error) {
                this.logger.error('Error in oasis spawn cron:', error);
            }
        });
    }

    private async cleanupUnclaimedOases(): Promise<void> {
        const now = new Date();
        const unclaimedExpiry = new Date(now.getTime() - OASIS_UNCLAIMED_DESPAWN_MS);
        await this.dbAccessorService.getCollection(OASES_COLLECTION).deleteMany({
            garrison: { $exists: false },
            spawnedAt: { $lt: unclaimedExpiry },
        });
    }

    private async findSpawnLocation(): Promise<{ x: number; y: number } | null> {
        const villages = await this.dbAccessorService
            .getCollection(GRIDS_COLLECTION)
            .aggregate([{ $match: { taken: true } }, { $sample: { size: 20 } }])
            .toArray();

        if (villages.length === 0) {
            return { x: Math.floor(WORLD_SIZE / 2), y: Math.floor(WORLD_SIZE / 2) };
        }

        const existingBosses = await this.dbAccessorService
            .getCollection(BOSSES_COLLECTION)
            .find({ isDefeated: false })
            .toArray();

        const existingOases = await this.dbAccessorService
            .getCollection(OASES_COLLECTION)
            .find({})
            .toArray();

        const shuffledVillages = villages.sort(() => Math.random() - 0.5);

        for (const village of shuffledVillages) {
            const offsetX =
                Math.floor(Math.random() * (OASIS_PROXIMITY_RANGE * 2 + 1)) - OASIS_PROXIMITY_RANGE;
            const offsetY =
                Math.floor(Math.random() * (OASIS_PROXIMITY_RANGE * 2 + 1)) - OASIS_PROXIMITY_RANGE;

            const x = Math.max(0, Math.min(WORLD_SIZE - 1, village.x + offsetX));
            const y = Math.max(0, Math.min(WORLD_SIZE - 1, village.y + offsetY));

            const cellTaken = await this.dbAccessorService
                .getCollection(GRIDS_COLLECTION)
                .findOne({ x, y, taken: true });

            if (cellTaken) continue;

            const bossAtLocation = existingBosses.find((b: any) => b.x === x && b.y === y);
            if (bossAtLocation) continue;

            const oasisAtLocation = existingOases.find((o: any) => o.x === x && o.y === y);
            if (oasisAtLocation) continue;

            return { x, y };
        }

        return null;
    }

    private async spawnOasis(tier: OasisTier, x: number, y: number): Promise<Oasis> {
        const resources = generateOasisResources(tier);
        const now = new Date();
        const oasis: Oasis = {
            x,
            y,
            tier,
            resourcesRemaining: resources,
            spawnedAt: now,
            lastHarvestTick: now,
        };

        await this.dbAccessorService.getCollection(OASES_COLLECTION).insertOne(oasis);
        return oasis;
    }

    async oasisExists(oasisId: string): Promise<{ exists: boolean }> {
        try {
            const oasis = await this.dbAccessorService
                .getCollection(OASES_COLLECTION)
                .findOne({ _id: new ObjectId(oasisId) }, { projection: { _id: 1 } });
            return { exists: !!oasis };
        } catch {
            return { exists: false };
        }
    }

    @Cron('*/10 * * * * *')
    async harvestOases(): Promise<void> {
        await this.serverContextService.forEachServer(async () => {
            try {
                const oases = (await this.dbAccessorService
                    .getCollection(OASES_COLLECTION)
                    .find({ garrison: { $exists: true, $ne: null } })
                    .toArray()) as Oasis[];

                const now = new Date();

                for (const oasis of oases) {
                    if (!oasis.garrison) continue;

                    const garrison = oasis.garrison;
                    const totalTroops = getTotalGarrisonTroops(garrison);
                    const troopCount = getTotalTroopCount(totalTroops);

                    if (troopCount <= 0) continue;

                    const lastTick = new Date(oasis.lastHarvestTick).getTime();
                    const secondsElapsed = (now.getTime() - lastTick) / 1000;
                    const harvestPerResource =
                        (troopCount * OASIS_HARVEST_RATE_PER_TROOP_PER_HOUR) / 3600 * secondsElapsed;

                    const woodHarvested = Math.min(
                        harvestPerResource,
                        oasis.resourcesRemaining.wood,
                    );
                    const stoneHarvested = Math.min(
                        harvestPerResource,
                        oasis.resourcesRemaining.stone,
                    );
                    const cropHarvested = Math.min(
                        harvestPerResource,
                        oasis.resourcesRemaining.crop,
                    );

                    const newStashWood = (garrison.stash.wood || 0) + woodHarvested;
                    const newStashStone = (garrison.stash.stone || 0) + stoneHarvested;
                    const newStashCrop = (garrison.stash.crop || 0) + cropHarvested;

                    const contributions = getGarrisonContributions(garrison);
                    const hasContribsInDb = Array.isArray(garrison.contributions) && garrison.contributions.length > 0;
                    const contribTroopCounts = contributions.map(c => getTotalTroopCount(c.troops));
                    const contribUpdates: Record<string, any> = {};

                    if (hasContribsInDb) {
                        for (let ci = 0; ci < contributions.length; ci++) {
                            const ratio = troopCount > 0 ? contribTroopCounts[ci] / troopCount : 0;
                            const cs = contributions[ci].stash || { wood: 0, stone: 0, crop: 0 };
                            contribUpdates[`garrison.contributions.${ci}.stash`] = {
                                wood: cs.wood + woodHarvested * ratio,
                                stone: cs.stone + stoneHarvested * ratio,
                                crop: cs.crop + cropHarvested * ratio,
                            };
                        }
                    } else {
                        for (let ci = 0; ci < contributions.length; ci++) {
                            const ratio = troopCount > 0 ? contribTroopCounts[ci] / troopCount : 0;
                            contributions[ci].stash = {
                                wood: (contributions[ci].stash?.wood || 0) + woodHarvested * ratio,
                                stone: (contributions[ci].stash?.stone || 0) + stoneHarvested * ratio,
                                crop: (contributions[ci].stash?.crop || 0) + cropHarvested * ratio,
                            };
                        }
                        contribUpdates['garrison.contributions'] = contributions;
                    }

                    const newWood = Math.max(0, oasis.resourcesRemaining.wood - woodHarvested);
                    const newStone = Math.max(0, oasis.resourcesRemaining.stone - stoneHarvested);
                    const newCrop = Math.max(0, oasis.resourcesRemaining.crop - cropHarvested);

                    const allDrained = newWood <= 0 && newStone <= 0 && newCrop <= 0;

                    if (allDrained) {
                        await this.autoRetreatFromOasis(oasis);
                    } else {
                        await this.dbAccessorService.getCollection(OASES_COLLECTION).updateOne(
                            { _id: oasis._id },
                            {
                                $set: {
                                    'resourcesRemaining.wood': newWood,
                                    'resourcesRemaining.stone': newStone,
                                    'resourcesRemaining.crop': newCrop,
                                    'garrison.stash.wood': newStashWood,
                                    'garrison.stash.stone': newStashStone,
                                    'garrison.stash.crop': newStashCrop,
                                    lastHarvestTick: now,
                                    ...contribUpdates,
                                },
                            },
                        );
                    }
                }
            } catch (error) {
                this.logger.error('Error in oasis harvest cron:', error);
            }
        });
    }

    private async autoRetreatFromOasis(oasis: Oasis): Promise<void> {
        const garrison = oasis.garrison!;
        const user = (await this.dbAccessorService
            .getCollection(USERS_COLLECTION)
            .findOne({ username: garrison.username })) as User;

        if (!user) {
            await this.dbAccessorService.getCollection(OASES_COLLECTION).deleteOne(
                { _id: oasis._id },
            );
            return;
        }

        const contributions = getGarrisonContributions(garrison);
        if (contributions.length === 0) {
            await this.dbAccessorService.getCollection(OASES_COLLECTION).deleteOne(
                { _id: oasis._id },
            );
            return;
        }

        const autoOasisName = oasisTierConfigs[oasis.tier]?.name || 'Oasis';
        const oasisIdStr = oasis._id!.toHexString();

        for (let i = 0; i < contributions.length; i++) {
            const contrib = contributions[i];
            const village = user.villages.find((v) => v.villageName === contrib.villageName);
            if (!village) continue;

            const troops = new TroopsAmounts(
                contrib.troops.spearFighters || 0,
                contrib.troops.swordFighters || 0,
                contrib.troops.axeFighters || 0,
                contrib.troops.archers || 0,
                contrib.troops.magicians || 0,
                contrib.troops.horsemen || 0,
                contrib.troops.catapults || 0,
            );

            const split = this.getResourcesForContrib(contrib, i, contributions, garrison);
            const resources = new ResourcesAmounts(split.wood, split.stone, split.crop);

            const distance = calculateDistance(village.location.x, village.location.y, oasis.x, oasis.y);
            const armySpeed = getArmySpeed(troops as any);
            const quickStepBonus = getSkillBonus(village.skills, SkillCategory.QUICK_STEP);
            const travelTimeMs = calculateTravelTimeMs(distance, armySpeed, quickStepBonus);
            const departureTime = new Date();
            const arrivalTime = new Date(departureTime.getTime() + travelTimeMs);

            await this.dbAccessorService.getCollection(MOVEMENTS_COLLECTION).insertOne({
                type: 'oasis_return',
                senderUsername: garrison.username,
                senderVillageName: contrib.villageName,
                targetUsername: garrison.username,
                targetVillageName: contrib.villageName,
                troops,
                resources,
                departureTime,
                arrivalTime,
                status: 'in_transit',
                oasisName: autoOasisName,
                oasisX: oasis.x,
                oasisY: oasis.y,
                oasisId: oasisIdStr,
            });

            await this.removeOasisTroopsTracking(garrison.username, contrib.villageName, oasisIdStr);

            const returningTroopCount =
                (troops.spearFighters || 0) +
                (troops.swordFighters || 0) +
                (troops.axeFighters || 0) +
                (troops.archers || 0) +
                (troops.magicians || 0) +
                (troops.horsemen || 0) +
                (troops.catapults || 0);
            if (returningTroopCount > 0) {
                await this.dbAccessorService.getCollection(USERS_COLLECTION).updateOne(
                    { username: garrison.username, 'villages.villageName': contrib.villageName },
                    { $inc: { 'villages.$.troopsInTransit': returningTroopCount } },
                );
            }
        }

        const totalStash = (garrison.stash.wood || 0) + (garrison.stash.stone || 0) + (garrison.stash.crop || 0);
        if (totalStash > 0) {
            this.dailyQuestService.incrementProgress(garrison.username, DailyQuestTrackingType.RETREAT_OASIS_WITH_RESOURCES, totalStash).catch(() => {});
            if (user.clanName) {
                this.clanQuestService.incrementClanProgress(user.clanName, garrison.username, ClanQuestTrackingType.TOTAL_OASIS_RESOURCES_HARVESTED, totalStash).catch(() => {});
            }
        }

        await this.dbAccessorService.getCollection(OASES_COLLECTION).deleteOne(
            { _id: oasis._id },
        );
    }

    async garrisonOasis(
        username: string,
        villageName: string,
        oasisId: string,
        troops: {
            spearFighters?: number;
            swordFighters?: number;
            axeFighters?: number;
            archers?: number;
            magicians?: number;
            horsemen?: number;
            catapults?: number;
        },
    ): Promise<{ travelTimeMs: number; isAttack: boolean; user?: any }> {
        const user = (await this.dbAccessorService
            .getCollection(USERS_COLLECTION)
            .findOne({ username })) as User;

        if (!user) {
            throw new HttpException('User not found', HttpStatus.NOT_FOUND);
        }

        const villageIndex = user.villages.findIndex((v) => v.villageName === villageName);
        const village = user.villages[villageIndex];
        if (!village || villageIndex < 0) {
            throw new HttpException('Village not found', HttpStatus.NOT_FOUND);
        }

        const troopsObj = new TroopsAmounts(
            troops.spearFighters || 0,
            troops.swordFighters || 0,
            troops.axeFighters || 0,
            troops.archers || 0,
            troops.magicians || 0,
            troops.horsemen || 0,
            troops.catapults || 0,
        );

        if (!this.hasTroopsToSend(troopsObj)) {
            throw new HttpException(
                'You must select at least one troop to send',
                HttpStatus.BAD_REQUEST,
            );
        }

        if (!this.doesUserHaveTroops(troopsObj, village.troops)) {
            throw new HttpException(
                'You chose more troops than you have',
                HttpStatus.BAD_REQUEST,
            );
        }

        const oasis = (await this.dbAccessorService
            .getCollection(OASES_COLLECTION)
            .findOne({ _id: new ObjectId(oasisId) })) as Oasis | null;

        if (!oasis) {
            throw new HttpException('Oasis not found', HttpStatus.NOT_FOUND);
        }

        const isAttack = !!oasis.garrison && oasis.garrison.username !== username;
        const isReinforcement = !!oasis.garrison && oasis.garrison.username === username;

        if (!isReinforcement) {
            const existingOasisForVillage = await this.dbAccessorService
                .getCollection(OASES_COLLECTION)
                .findOne({
                    'garrison.username': username,
                    'garrison.contributions.villageName': villageName,
                    _id: { $ne: new ObjectId(oasisId) },
                });

            if (existingOasisForVillage) {
                throw new HttpException(
                    'This village is already stationed at an oasis. Withdraw troops first to support another oasis.',
                    HttpStatus.BAD_REQUEST,
                );
            }

            const inTransitToOtherOasis = await this.dbAccessorService
                .getCollection(MOVEMENTS_COLLECTION)
                .findOne({
                    senderUsername: username,
                    senderVillageName: villageName,
                    type: { $in: ['oasis_garrison', 'oasis_attack'] },
                    status: 'in_transit',
                    oasisId: { $ne: oasisId },
                });

            if (inTransitToOtherOasis) {
                throw new HttpException(
                    'This village is already stationed at an oasis. Withdraw troops first to support another oasis.',
                    HttpStatus.BAD_REQUEST,
                );
            }
        }

        if (isAttack && user.energy < 1) {
            throw new HttpException('You need 1 energy to attack an occupied oasis', HttpStatus.BAD_REQUEST);
        }

        const troopsPath = `villages.${villageIndex}.troops`;
        const troopCount =
            (troopsObj.spearFighters || 0) +
            (troopsObj.swordFighters || 0) +
            (troopsObj.axeFighters || 0) +
            (troopsObj.archers || 0) +
            (troopsObj.magicians || 0) +
            (troopsObj.horsemen || 0) +
            (troopsObj.catapults || 0);
        const updateOps: any = {
            $inc: {
                [`${troopsPath}.spearFighters`]: -(troopsObj.spearFighters || 0),
                [`${troopsPath}.swordFighters`]: -(troopsObj.swordFighters || 0),
                [`${troopsPath}.axeFighters`]: -(troopsObj.axeFighters || 0),
                [`${troopsPath}.archers`]: -(troopsObj.archers || 0),
                [`${troopsPath}.magicians`]: -(troopsObj.magicians || 0),
                [`${troopsPath}.horsemen`]: -(troopsObj.horsemen || 0),
                [`${troopsPath}.catapults`]: -(troopsObj.catapults || 0),
                [`villages.${villageIndex}.troopsInTransit`]: troopCount,
            },
        };

        if (isAttack) {
            updateOps.$inc.energy = -1;
        }

        const atomicResult = await this.dbAccessorService
            .getCollection(USERS_COLLECTION)
            .findOneAndUpdate(
                {
                    username,
                    [`${troopsPath}.spearFighters`]: { $gte: troopsObj.spearFighters || 0 },
                    [`${troopsPath}.swordFighters`]: { $gte: troopsObj.swordFighters || 0 },
                    [`${troopsPath}.axeFighters`]: { $gte: troopsObj.axeFighters || 0 },
                    [`${troopsPath}.archers`]: { $gte: troopsObj.archers || 0 },
                    [`${troopsPath}.magicians`]: { $gte: troopsObj.magicians || 0 },
                    [`${troopsPath}.horsemen`]: { $gte: troopsObj.horsemen || 0 },
                    [`${troopsPath}.catapults`]: { $gte: troopsObj.catapults || 0 },
                    ...(isAttack ? { energy: { $gte: 1 } } : {}),
                },
                updateOps,
                { returnDocument: 'after' },
            );

        const updatedUser = atomicResult?.value ?? atomicResult;
        if (!updatedUser) {
            throw new HttpException(
                'Failed to send troops - not enough troops or energy',
                HttpStatus.CONFLICT,
            );
        }

        const distance = calculateDistance(
            village.location.x,
            village.location.y,
            oasis.x,
            oasis.y,
        );
        const armySpeed = getArmySpeed(troopsObj as any);
        const quickStepBonus = getSkillBonus(village.skills, SkillCategory.QUICK_STEP);
        const travelTimeMs = calculateTravelTimeMs(distance, armySpeed, quickStepBonus);
        const departureTime = new Date();
        const arrivalTime = new Date(departureTime.getTime() + travelTimeMs);

        const movementType = 'oasis_garrison';
        await this.dbAccessorService.getCollection(MOVEMENTS_COLLECTION).insertOne({
            type: movementType,
            senderUsername: username,
            senderVillageName: villageName,
            targetUsername: 'oasis',
            targetVillageName: oasisId,
            troops: troopsObj,
            oasisId,
            departureTime,
            arrivalTime,
            status: 'in_transit',
        });

        return { travelTimeMs, isAttack, user: updatedUser };
    }

    async retreatFromOasis(
        username: string,
        oasisId: string,
    ): Promise<{ travelTimeMs: number }> {
        const oasis = (await this.dbAccessorService
            .getCollection(OASES_COLLECTION)
            .findOne({ _id: new ObjectId(oasisId) })) as Oasis | null;

        if (!oasis) {
            throw new HttpException('Oasis not found', HttpStatus.NOT_FOUND);
        }

        if (!oasis.garrison || oasis.garrison.username !== username) {
            throw new HttpException(
                'You do not have troops stationed at this oasis',
                HttpStatus.FORBIDDEN,
            );
        }

        const user = (await this.dbAccessorService
            .getCollection(USERS_COLLECTION)
            .findOne({ username })) as User;

        if (!user) {
            throw new HttpException('User not found', HttpStatus.NOT_FOUND);
        }

        const garrison = oasis.garrison;
        const contributions = getGarrisonContributions(garrison);

        if (contributions.length === 0) {
            throw new HttpException('No troops to retreat', HttpStatus.BAD_REQUEST);
        }

        const retreatOasisName = oasisTierConfigs[oasis.tier]?.name || 'Oasis';
        const oasisIdStr = oasis._id!.toHexString();
        let maxTravelTimeMs = 0;

        for (let i = 0; i < contributions.length; i++) {
            const contrib = contributions[i];
            const village = user.villages.find((v) => v.villageName === contrib.villageName);
            if (!village) continue;

            const troops = new TroopsAmounts(
                contrib.troops.spearFighters || 0,
                contrib.troops.swordFighters || 0,
                contrib.troops.axeFighters || 0,
                contrib.troops.archers || 0,
                contrib.troops.magicians || 0,
                contrib.troops.horsemen || 0,
                contrib.troops.catapults || 0,
            );

            const split = this.getResourcesForContrib(contrib, i, contributions, garrison);
            const resources = new ResourcesAmounts(split.wood, split.stone, split.crop);

            const distance = calculateDistance(village.location.x, village.location.y, oasis.x, oasis.y);
            const armySpeed = getArmySpeed(troops as any);
            const quickStepBonus = getSkillBonus(village.skills, SkillCategory.QUICK_STEP);
            const travelTimeMs = calculateTravelTimeMs(distance, armySpeed, quickStepBonus);
            if (travelTimeMs > maxTravelTimeMs) maxTravelTimeMs = travelTimeMs;

            const departureTime = new Date();
            const arrivalTime = new Date(departureTime.getTime() + travelTimeMs);

            await this.dbAccessorService.getCollection(MOVEMENTS_COLLECTION).insertOne({
                type: 'oasis_return',
                senderUsername: username,
                senderVillageName: contrib.villageName,
                targetUsername: username,
                targetVillageName: contrib.villageName,
                troops,
                resources,
                departureTime,
                arrivalTime,
                status: 'in_transit',
                oasisName: retreatOasisName,
                oasisX: oasis.x,
                oasisY: oasis.y,
                oasisId: oasisIdStr,
            });

            await this.removeOasisTroopsTracking(username, contrib.villageName, oasisIdStr);

            const returningTroopCount =
                (troops.spearFighters || 0) +
                (troops.swordFighters || 0) +
                (troops.axeFighters || 0) +
                (troops.archers || 0) +
                (troops.magicians || 0) +
                (troops.horsemen || 0) +
                (troops.catapults || 0);
            if (returningTroopCount > 0) {
                await this.dbAccessorService.getCollection(USERS_COLLECTION).updateOne(
                    { username, 'villages.villageName': contrib.villageName },
                    { $inc: { 'villages.$.troopsInTransit': returningTroopCount } },
                );
            }
        }

        const totalStash = (garrison.stash.wood || 0) + (garrison.stash.stone || 0) + (garrison.stash.crop || 0);
        if (totalStash > 0) {
            this.dailyQuestService.incrementProgress(username, DailyQuestTrackingType.RETREAT_OASIS_WITH_RESOURCES, totalStash).catch(() => {});
            if (user.clanName) {
                this.clanQuestService.incrementClanProgress(user.clanName, username, ClanQuestTrackingType.TOTAL_OASIS_RESOURCES_HARVESTED, totalStash).catch(() => {});
            }
        }

        const allDrained =
            oasis.resourcesRemaining.wood <= 0 &&
            oasis.resourcesRemaining.stone <= 0 &&
            oasis.resourcesRemaining.crop <= 0;

        if (allDrained) {
            await this.dbAccessorService.getCollection(OASES_COLLECTION).deleteOne(
                { _id: oasis._id },
            );
        } else {
            await this.dbAccessorService.getCollection(OASES_COLLECTION).updateOne(
                { _id: oasis._id },
                { $unset: { garrison: '' } },
            );
        }

        return { travelTimeMs: maxTravelTimeMs };
    }

    async retreatVillagesFromOasis(
        username: string,
        oasisId: string,
        villageNames: string[],
    ): Promise<{ travelTimeMs: number }> {
        const oasis = (await this.dbAccessorService
            .getCollection(OASES_COLLECTION)
            .findOne({ _id: new ObjectId(oasisId) })) as Oasis | null;

        if (!oasis) {
            throw new HttpException('Oasis not found', HttpStatus.NOT_FOUND);
        }

        if (!oasis.garrison || oasis.garrison.username !== username) {
            throw new HttpException(
                'You do not have troops stationed at this oasis',
                HttpStatus.FORBIDDEN,
            );
        }

        const user = (await this.dbAccessorService
            .getCollection(USERS_COLLECTION)
            .findOne({ username })) as User;

        if (!user) {
            throw new HttpException('User not found', HttpStatus.NOT_FOUND);
        }

        const allContributions = getGarrisonContributions(oasis.garrison);
        const retreatingContribs = allContributions.filter(c => villageNames.includes(c.villageName));
        const remainingContribs = allContributions.filter(c => !villageNames.includes(c.villageName));

        if (retreatingContribs.length === 0) {
            throw new HttpException('No matching villages found at this oasis', HttpStatus.BAD_REQUEST);
        }

        const isFullRetreat = remainingContribs.length === 0 || remainingContribs.every(c => getTotalTroopCount(c.troops) === 0);

        if (isFullRetreat) {
            return this.retreatFromOasis(username, oasisId);
        }

        const garrison = oasis.garrison;

        const retreatOasisName = oasisTierConfigs[oasis.tier]?.name || 'Oasis';
        const oasisIdStr = oasis._id!.toHexString();
        let maxTravelTimeMs = 0;
        let retreatedStash = { wood: 0, stone: 0, crop: 0 };

        for (const contrib of retreatingContribs) {
            const village = user.villages.find((v) => v.villageName === contrib.villageName);
            if (!village) continue;

            const troops = new TroopsAmounts(
                contrib.troops.spearFighters || 0,
                contrib.troops.swordFighters || 0,
                contrib.troops.axeFighters || 0,
                contrib.troops.archers || 0,
                contrib.troops.magicians || 0,
                contrib.troops.horsemen || 0,
                contrib.troops.catapults || 0,
            );

            const contribIdx = allContributions.indexOf(contrib);
            const split = this.getResourcesForContrib(contrib, contribIdx, allContributions, garrison);
            retreatedStash.wood += split.wood;
            retreatedStash.stone += split.stone;
            retreatedStash.crop += split.crop;
            const resources = new ResourcesAmounts(split.wood, split.stone, split.crop);

            const distance = calculateDistance(village.location.x, village.location.y, oasis.x, oasis.y);
            const armySpeed = getArmySpeed(troops as any);
            const quickStepBonus = getSkillBonus(village.skills, SkillCategory.QUICK_STEP);
            const travelTimeMs = calculateTravelTimeMs(distance, armySpeed, quickStepBonus);
            if (travelTimeMs > maxTravelTimeMs) maxTravelTimeMs = travelTimeMs;

            const departureTime = new Date();
            const arrivalTime = new Date(departureTime.getTime() + travelTimeMs);

            await this.dbAccessorService.getCollection(MOVEMENTS_COLLECTION).insertOne({
                type: 'oasis_return',
                senderUsername: username,
                senderVillageName: contrib.villageName,
                targetUsername: username,
                targetVillageName: contrib.villageName,
                troops,
                resources,
                departureTime,
                arrivalTime,
                status: 'in_transit',
                oasisName: retreatOasisName,
                oasisX: oasis.x,
                oasisY: oasis.y,
                oasisId: oasisIdStr,
            });

            await this.removeOasisTroopsTracking(username, contrib.villageName, oasisIdStr);

            const returningTroopCount =
                (troops.spearFighters || 0) +
                (troops.swordFighters || 0) +
                (troops.axeFighters || 0) +
                (troops.archers || 0) +
                (troops.magicians || 0) +
                (troops.horsemen || 0) +
                (troops.catapults || 0);
            if (returningTroopCount > 0) {
                await this.dbAccessorService.getCollection(USERS_COLLECTION).updateOne(
                    { username, 'villages.villageName': contrib.villageName },
                    { $inc: { 'villages.$.troopsInTransit': returningTroopCount } },
                );
            }
        }

        const remainingStash = {
            wood: Math.max(0, (garrison.stash.wood || 0) - retreatedStash.wood),
            stone: Math.max(0, (garrison.stash.stone || 0) - retreatedStash.stone),
            crop: Math.max(0, (garrison.stash.crop || 0) - retreatedStash.crop),
        };

        await this.dbAccessorService.getCollection(OASES_COLLECTION).updateOne(
            { _id: oasis._id },
            {
                $set: {
                    'garrison.contributions': remainingContribs,
                    'garrison.stash': remainingStash,
                },
            },
        );

        return { travelTimeMs: maxTravelTimeMs };
    }

    async attackOasis(
        username: string,
        villageName: string,
        oasisId: string,
        troops: {
            spearFighters?: number;
            swordFighters?: number;
            axeFighters?: number;
            archers?: number;
            magicians?: number;
            horsemen?: number;
            catapults?: number;
        },
    ): Promise<{ travelTimeMs: number }> {
        return this.garrisonOasis(username, villageName, oasisId, troops).then((r) => ({
            travelTimeMs: r.travelTimeMs,
        }));
    }

    async getOasisInfo(oasisId: string, username: string, villageName?: string): Promise<any> {
        const oasis = (await this.dbAccessorService
            .getCollection(OASES_COLLECTION)
            .findOne({ _id: new ObjectId(oasisId) })) as Oasis | null;

        if (!oasis) {
            throw new HttpException('Oasis not found', HttpStatus.NOT_FOUND);
        }

        let villageAtOtherOasis = false;
        if (villageName) {
            const oasisObjId = new ObjectId(oasisId);
            const atOtherOasis = await this.dbAccessorService
                .getCollection(OASES_COLLECTION)
                .findOne({
                    'garrison.username': username,
                    'garrison.contributions.villageName': villageName,
                    _id: { $ne: oasisObjId },
                });
            if (!atOtherOasis) {
                const inTransit = await this.dbAccessorService
                    .getCollection(MOVEMENTS_COLLECTION)
                    .findOne({
                        senderUsername: username,
                        senderVillageName: villageName,
                        type: { $in: ['oasis_garrison', 'oasis_attack'] },
                        status: 'in_transit',
                        oasisId: { $ne: oasisId },
                    });
                villageAtOtherOasis = !!inTransit;
            } else {
                villageAtOtherOasis = true;
            }
        }

        const isOccupier = oasis.garrison?.username === username;

        if (isOccupier) {
            const garrison = oasis.garrison!;
            const contributions = getGarrisonContributions(garrison);

            const totalTroops = getTotalGarrisonTroops(garrison);
            const troopCount = getTotalTroopCount(totalTroops);
            const now = new Date();
            const lastTick = new Date(oasis.lastHarvestTick).getTime();
            const secondsElapsed = Math.max(0, (now.getTime() - lastTick) / 1000);
            const harvestPerResource = troopCount > 0
                ? (troopCount * OASIS_HARVEST_RATE_PER_TROOP_PER_HOUR) / 3600 * secondsElapsed
                : 0;

            const projectedRemaining = {
                wood: Math.max(0, oasis.resourcesRemaining.wood - Math.min(harvestPerResource, oasis.resourcesRemaining.wood)),
                stone: Math.max(0, oasis.resourcesRemaining.stone - Math.min(harvestPerResource, oasis.resourcesRemaining.stone)),
                crop: Math.max(0, oasis.resourcesRemaining.crop - Math.min(harvestPerResource, oasis.resourcesRemaining.crop)),
            };
            const woodHarvested = oasis.resourcesRemaining.wood - projectedRemaining.wood;
            const stoneHarvested = oasis.resourcesRemaining.stone - projectedRemaining.stone;
            const cropHarvested = oasis.resourcesRemaining.crop - projectedRemaining.crop;

            const projectedStash = {
                wood: (garrison.stash.wood || 0) + woodHarvested,
                stone: (garrison.stash.stone || 0) + stoneHarvested,
                crop: (garrison.stash.crop || 0) + cropHarvested,
            };

            const contribTroopCounts = contributions.map(c => getTotalTroopCount(c.troops));
            const projectedContributions = contributions.map((c, i) => {
                const ratio = troopCount > 0 ? contribTroopCounts[i] / troopCount : 0;
                return {
                    ...c,
                    stash: {
                        wood: (c.stash?.wood || 0) + woodHarvested * ratio,
                        stone: (c.stash?.stone || 0) + stoneHarvested * ratio,
                        crop: (c.stash?.crop || 0) + cropHarvested * ratio,
                    },
                };
            });

            const normalizedGarrison = {
                username: garrison.username,
                contributions: projectedContributions,
                stash: projectedStash,
                totalForOccupier: garrison.totalForOccupier,
                garrisonedAt: garrison.garrisonedAt,
            };
            return {
                _id: oasis._id?.toHexString(),
                x: oasis.x,
                y: oasis.y,
                tier: oasis.tier,
                resourcesRemaining: projectedRemaining,
                garrison: normalizedGarrison,
                spawnedAt: oasis.spawnedAt,
                lastHarvestTick: now,
                villageAtOtherOasis,
            };
        }

        // Check if a clanmate owns this oasis
        if (oasis.garrison) {
            const requestingUser = (await this.dbAccessorService
                .getCollection(USERS_COLLECTION)
                .findOne({ username }, { projection: { clanName: 1 } })) as any;
            if (requestingUser?.clanName) {
                const garrisonUser = (await this.dbAccessorService
                    .getCollection(USERS_COLLECTION)
                    .findOne({ username: oasis.garrison.username }, { projection: { clanName: 1 } })) as any;
                if (garrisonUser?.clanName === requestingUser.clanName) {
                    return {
                        _id: oasis._id?.toHexString(),
                        x: oasis.x,
                        y: oasis.y,
                        tier: oasis.tier,
                        clanOwner: oasis.garrison.username,
                        villageAtOtherOasis,
                    };
                }
            }
        }

        return {
            _id: oasis._id?.toHexString(),
            x: oasis.x,
            y: oasis.y,
            tier: oasis.tier,
            resourcesRemaining: oasis.resourcesRemaining,
            occupied: !!oasis.garrison,
            villageAtOtherOasis,
        };
    }

    async getOasesForMap(
        startX: number,
        startY: number,
        size: number = 21,
    ): Promise<{ _id: string; x: number; y: number; tier: OasisTier }[]> {
        const oases = (await this.dbAccessorService
            .getCollection(OASES_COLLECTION)
            .find({
                x: { $gte: startX, $lt: startX + size },
                y: { $gte: startY, $lt: startY + size },
            })
            .project({ x: 1, y: 1, tier: 1 })
            .toArray()) as Oasis[];

        return oases.map((o) => ({
            _id: o._id!.toHexString(),
            x: o.x,
            y: o.y,
            tier: o.tier,
        }));
    }

    async getAllOases(): Promise<{ _id: string; x: number; y: number }[]> {
        const oases = (await this.dbAccessorService
            .getCollection(OASES_COLLECTION)
            .find({})
            .project({ x: 1, y: 1 })
            .toArray()) as Oasis[];

        return oases.map((o) => ({
            _id: o._id!.toHexString(),
            x: o.x,
            y: o.y,
        }));
    }

    async resolveOasisGarrisonMovement(movement: {
        senderUsername: string;
        senderVillageName: string;
        oasisId: string;
        troops: any;
    }): Promise<void> {
        const oasis = (await this.dbAccessorService
            .getCollection(OASES_COLLECTION)
            .findOne({ _id: new ObjectId(movement.oasisId) })) as Oasis | null;

        if (!oasis) {
            await this.refundTroopsToVillage(movement.senderUsername, movement.senderVillageName, movement.troops);
            return;
        }

        if (oasis.garrison && oasis.garrison.username !== movement.senderUsername) {
            await this.resolveOasisCombat(movement, oasis, 'oasis_garrison');
            return;
        }

        if (oasis.garrison && oasis.garrison.username === movement.senderUsername) {
            const existingContribs = getGarrisonContributions(oasis.garrison);
            const incomingTroops = {
                spearFighters: movement.troops.spearFighters || 0,
                swordFighters: movement.troops.swordFighters || 0,
                axeFighters: movement.troops.axeFighters || 0,
                archers: movement.troops.archers || 0,
                magicians: movement.troops.magicians || 0,
                horsemen: movement.troops.horsemen || 0,
                catapults: movement.troops.catapults || 0,
            };

            const existingIdx = existingContribs.findIndex(c => c.villageName === movement.senderVillageName);
            if (existingIdx >= 0) {
                const existing = existingContribs[existingIdx].troops;
                existingContribs[existingIdx].troops = {
                    spearFighters: (existing.spearFighters || 0) + incomingTroops.spearFighters,
                    swordFighters: (existing.swordFighters || 0) + incomingTroops.swordFighters,
                    axeFighters: (existing.axeFighters || 0) + incomingTroops.axeFighters,
                    archers: (existing.archers || 0) + incomingTroops.archers,
                    magicians: (existing.magicians || 0) + incomingTroops.magicians,
                    horsemen: (existing.horsemen || 0) + incomingTroops.horsemen,
                    catapults: (existing.catapults || 0) + incomingTroops.catapults,
                };
            } else {
                existingContribs.push({ villageName: movement.senderVillageName, troops: incomingTroops, stash: { wood: 0, stone: 0, crop: 0 } });
            }

            await this.dbAccessorService.getCollection(OASES_COLLECTION).updateOne(
                { _id: oasis._id },
                { $set: { 'garrison.contributions': existingContribs } },
            );

            const reinforceTroopCount =
                (incomingTroops.spearFighters || 0) +
                (incomingTroops.swordFighters || 0) +
                (incomingTroops.axeFighters || 0) +
                (incomingTroops.archers || 0) +
                (incomingTroops.magicians || 0) +
                (incomingTroops.horsemen || 0) +
                (incomingTroops.catapults || 0);
            await this.removeOasisTroopsTracking(movement.senderUsername, movement.senderVillageName, movement.oasisId);
            const villageContrib = existingContribs.find(c => c.villageName === movement.senderVillageName);
            await this.dbAccessorService.getCollection(USERS_COLLECTION).updateOne(
                { username: movement.senderUsername, 'villages.villageName': movement.senderVillageName },
                {
                    $inc: { 'villages.$.troopsInTransit': -reinforceTroopCount },
                    $push: { 'villages.$.oasisTroopsSent': { oasisId: movement.oasisId, troops: villageContrib?.troops || incomingTroops } } as any,
                },
            );
            return;
        }

        const user = (await this.dbAccessorService
            .getCollection(USERS_COLLECTION)
            .findOne({ username: movement.senderUsername })) as User;

        if (!user) return;

        const village = user.villages.find((v) => v.villageName === movement.senderVillageName);
        if (!village) return;

        const newContribution: OasisGarrisonContribution = {
            villageName: movement.senderVillageName,
            troops: {
                spearFighters: movement.troops.spearFighters || 0,
                swordFighters: movement.troops.swordFighters || 0,
                axeFighters: movement.troops.axeFighters || 0,
                archers: movement.troops.archers || 0,
                magicians: movement.troops.magicians || 0,
                horsemen: movement.troops.horsemen || 0,
                catapults: movement.troops.catapults || 0,
            },
            stash: { wood: 0, stone: 0, crop: 0 },
        };

        const garrison: OasisGarrison = {
            username: movement.senderUsername,
            contributions: [newContribution],
            stash: { wood: 0, stone: 0, crop: 0 },
            totalForOccupier: {
                wood: oasis.resourcesRemaining.wood,
                stone: oasis.resourcesRemaining.stone,
                crop: oasis.resourcesRemaining.crop,
            },
            garrisonedAt: new Date(),
        };

        await this.dbAccessorService.getCollection(OASES_COLLECTION).updateOne(
            { _id: oasis._id },
            {
                $set: {
                    garrison,
                    lastHarvestTick: new Date(),
                },
            },
        );

        const arrivedTroopCount =
            (movement.troops.spearFighters || 0) +
            (movement.troops.swordFighters || 0) +
            (movement.troops.axeFighters || 0) +
            (movement.troops.archers || 0) +
            (movement.troops.magicians || 0) +
            (movement.troops.horsemen || 0) +
            (movement.troops.catapults || 0);
        await this.dbAccessorService.getCollection(USERS_COLLECTION).updateOne(
            { username: movement.senderUsername, 'villages.villageName': movement.senderVillageName },
            {
                $inc: { 'villages.$.troopsInTransit': -arrivedTroopCount },
                $push: { 'villages.$.oasisTroopsSent': { oasisId: movement.oasisId, troops: newContribution.troops } } as any,
            },
        );

        await this.dbAccessorService.getCollection(USERS_COLLECTION).updateOne(
            { username: movement.senderUsername },
            { $inc: { 'totalStats.oasesConquered': 1 } },
        );

        this.dailyQuestService.incrementProgress(movement.senderUsername, DailyQuestTrackingType.GARRISON_OASIS, 1).catch(() => {});
        if (user.clanName) {
            this.clanQuestService.incrementClanProgress(user.clanName, movement.senderUsername, ClanQuestTrackingType.TOTAL_OASES_CONQUERED, 1).catch(() => {});
        }

        const oasisName = oasisTierConfigs[oasis.tier]?.name || 'Oasis';
        await this.messagesService.sendClanNotificationMessage(
            movement.senderUsername,
            'Oasis Claimed',
            `Your troops have occupied {oasis:${oasisName}|${oasis.x}|${oasis.y}|${oasis._id}}. You now control this oasis.`,
        );

        const updatedUser = (await this.dbAccessorService
            .getCollection(USERS_COLLECTION)
            .findOne({ username: movement.senderUsername })) as User;
        if (
            updatedUser &&
            unlockAchievements(updatedUser, ['totalStats.oasesConquered'])
        ) {
            await this.dbAccessorService.getCollection(USERS_COLLECTION).updateOne(
                { username: movement.senderUsername },
                { $set: { unlockedAchievements: (updatedUser as any).unlockedAchievements } },
            );
        }
    }

    async resolveOasisAttackMovement(movement: {
        senderUsername: string;
        senderVillageName: string;
        oasisId: string;
        troops: any;
    }): Promise<void> {
        const oasis = (await this.dbAccessorService
            .getCollection(OASES_COLLECTION)
            .findOne({ _id: new ObjectId(movement.oasisId) })) as Oasis | null;

        if (!oasis || !oasis.garrison) return;

        if (oasis.garrison.username === movement.senderUsername) {
            await this.resolveOasisGarrisonMovement(movement);
            return;
        }

        await this.resolveOasisCombat(movement, oasis, 'oasis_attack');
    }

    private async resolveOasisCombat(
        movement: {
            senderUsername: string;
            senderVillageName: string;
            oasisId: string;
            troops: any;
        },
        oasis: Oasis,
        movementType: string,
    ): Promise<void> {
        const garrison = oasis.garrison!;
        const defenderContributions = getGarrisonContributions(garrison);
        const attackerTroops = new TroopsAmounts(
            movement.troops.spearFighters || 0,
            movement.troops.swordFighters || 0,
            movement.troops.axeFighters || 0,
            movement.troops.archers || 0,
            movement.troops.magicians || 0,
            movement.troops.horsemen || 0,
            movement.troops.catapults || 0,
        );

        const totalDefTroops = getTotalGarrisonTroops(garrison);
        const defenderTroops = new TroopsAmounts(
            totalDefTroops.spearFighters,
            totalDefTroops.swordFighters,
            totalDefTroops.axeFighters,
            totalDefTroops.archers,
            totalDefTroops.magicians,
            totalDefTroops.horsemen,
            totalDefTroops.catapults,
        );
        const defenderFirstVillageName = defenderContributions[0]?.villageName || '';

        const defenderUser = (await this.dbAccessorService
            .getCollection(USERS_COLLECTION)
            .findOne({ username: garrison.username })) as User | null;

        const attackerUser = (await this.dbAccessorService
            .getCollection(USERS_COLLECTION)
            .findOne({ username: movement.senderUsername })) as User;

        if (!attackerUser) return;

        const attackerVillage = attackerUser.villages.find(
            (v) => v.villageName === movement.senderVillageName,
        );
        if (!attackerVillage) return;

        const attackingPower = this.calculateAttackingPower(attackerTroops);
        const sharperBladesBonus = getSkillBonus(
            attackerVillage.skills,
            SkillCategory.SHARPER_BLADES,
        );
        const totalAttackingPower = Math.floor(attackingPower * (1 + sharperBladesBonus));

        const defenderDefence = this.calculateGarrisonDefenceWithVillageBonuses(
            defenderContributions,
            defenderUser,
        );

        const attackToDefenceRatio = totalAttackingPower / (defenderDefence || 1);
        const defenceToAttackRatio = defenderDefence / (totalAttackingPower || 1);

        let killedAttackerTroops: TroopsAmounts;
        let killedDefenderTroops: TroopsAmounts;
        let attackWon: boolean;

        if (attackToDefenceRatio <= 1) {
            attackWon = false;
            killedAttackerTroops = this.calculateKilledTroopsByRatio(attackerTroops, 1);
            killedDefenderTroops = this.calculateKilledTroopsByRatio(
                defenderTroops,
                attackToDefenceRatio,
            );
        } else {
            attackWon = true;
            killedDefenderTroops = this.calculateKilledTroopsByRatio(defenderTroops, 1);
            const killedRatio = defenceToAttackRatio;
            killedAttackerTroops = this.calculateKilledTroopsByRatio(
                attackerTroops,
                killedRatio,
            );
        }

        const loot = attackWon
            ? new ResourcesAmounts(
                  garrison.stash.wood || 0,
                  garrison.stash.stone || 0,
                  garrison.stash.crop || 0,
              )
            : new ResourcesAmounts(0, 0, 0);

        const attackReport = new AttackReport(
            movement.senderUsername,
            attackerVillage.villageName,
            garrison.username,
            defenderFirstVillageName,
            new Date(),
            attackWon,
            loot,
            totalAttackingPower,
            defenderDefence,
            defenderDefence,
            0,
            0,
            attackerTroops,
            killedAttackerTroops,
            defenderTroops,
            killedDefenderTroops,
            new TroopsAmounts(0, 0, 0, 0, 0, 0, 0),
            new TroopsAmounts(0, 0, 0, 0, 0, 0, 0),
            'oasis',
        );
        attackReport.attackerVillageX = attackerVillage.location.x;
        attackReport.attackerVillageY = attackerVillage.location.y;
        attackReport.oasisId = oasis._id?.toHexString();
        attackReport.oasisName = oasisTierConfigs[oasis.tier]?.name || 'Oasis';
        attackReport.oasisX = oasis.x;
        attackReport.oasisY = oasis.y;
        await this.reportsService.saveAttackReport(attackReport);

        const survivingAttackers = new TroopsAmounts(
            Math.max(0, attackerTroops.spearFighters - killedAttackerTroops.spearFighters),
            Math.max(0, attackerTroops.swordFighters - killedAttackerTroops.swordFighters),
            Math.max(0, attackerTroops.axeFighters - killedAttackerTroops.axeFighters),
            Math.max(0, attackerTroops.archers - killedAttackerTroops.archers),
            Math.max(0, attackerTroops.magicians - killedAttackerTroops.magicians),
            Math.max(0, attackerTroops.horsemen - killedAttackerTroops.horsemen),
            Math.max(0, attackerTroops.catapults - killedAttackerTroops.catapults),
        );

        if (attackWon) {
            const totalSurviving =
                survivingAttackers.spearFighters +
                survivingAttackers.swordFighters +
                survivingAttackers.axeFighters +
                survivingAttackers.archers +
                survivingAttackers.magicians +
                survivingAttackers.horsemen +
                survivingAttackers.catapults;

            if (totalSurviving > 0) {
                const lootWood = garrison.stash.wood || 0;
                const lootStone = garrison.stash.stone || 0;
                const lootCrop = garrison.stash.crop || 0;

                const newGarrison: OasisGarrison = {
                    username: movement.senderUsername,
                    contributions: [{
                        villageName: movement.senderVillageName,
                        troops: {
                            spearFighters: survivingAttackers.spearFighters,
                            swordFighters: survivingAttackers.swordFighters,
                            axeFighters: survivingAttackers.axeFighters,
                            archers: survivingAttackers.archers,
                            magicians: survivingAttackers.magicians,
                            horsemen: survivingAttackers.horsemen,
                            catapults: survivingAttackers.catapults,
                        },
                        stash: { wood: lootWood, stone: lootStone, crop: lootCrop },
                    }],
                    stash: { wood: lootWood, stone: lootStone, crop: lootCrop },
                    totalForOccupier: {
                        wood: oasis.resourcesRemaining.wood + lootWood,
                        stone: oasis.resourcesRemaining.stone + lootStone,
                        crop: oasis.resourcesRemaining.crop + lootCrop,
                    },
                    garrisonedAt: new Date(),
                };

                await this.dbAccessorService.getCollection(OASES_COLLECTION).updateOne(
                    { _id: oasis._id },
                    {
                        $set: {
                            garrison: newGarrison,
                            lastHarvestTick: new Date(),
                        },
                    },
                );
            } else {
                await this.dbAccessorService.getCollection(OASES_COLLECTION).updateOne(
                    { _id: oasis._id },
                    { $unset: { garrison: '' } },
                );
            }

            const oasisIdStr = oasis._id!.toHexString();
            for (const dc of defenderContributions) {
                await this.removeOasisTroopsTracking(garrison.username, dc.villageName, oasisIdStr);
            }

            const originalTroopCount =
                (movement.troops.spearFighters || 0) +
                (movement.troops.swordFighters || 0) +
                (movement.troops.axeFighters || 0) +
                (movement.troops.archers || 0) +
                (movement.troops.magicians || 0) +
                (movement.troops.horsemen || 0) +
                (movement.troops.catapults || 0);

            if (totalSurviving > 0) {
                await this.dbAccessorService.getCollection(USERS_COLLECTION).updateOne(
                    { username: movement.senderUsername, 'villages.villageName': movement.senderVillageName },
                    {
                        $inc: { 'villages.$.troopsInTransit': -originalTroopCount },
                        $push: { 'villages.$.oasisTroopsSent': { oasisId: oasisIdStr, troops: survivingAttackers } } as any,
                    },
                );
            } else {
                await this.dbAccessorService.getCollection(USERS_COLLECTION).updateOne(
                    { username: movement.senderUsername, 'villages.villageName': movement.senderVillageName },
                    { $inc: { 'villages.$.troopsInTransit': -originalTroopCount } },
                );
            }

            await this.dbAccessorService.getCollection(USERS_COLLECTION).updateOne(
                { username: movement.senderUsername },
                { $inc: { 'totalStats.oasesConquered': 1 } },
            );

            this.dailyQuestService.incrementProgress(movement.senderUsername, DailyQuestTrackingType.GARRISON_OASIS, 1).catch(() => {});
            this.dailyQuestService.incrementProgress(movement.senderUsername, DailyQuestTrackingType.ATTACK_OASIS, 1).catch(() => {});
            if (attackerUser.clanName) {
                this.clanQuestService.incrementClanProgress(attackerUser.clanName, movement.senderUsername, ClanQuestTrackingType.TOTAL_OASES_CONQUERED, 1).catch(() => {});
            }

            const updatedUser = (await this.dbAccessorService
                .getCollection(USERS_COLLECTION)
                .findOne({ username: movement.senderUsername })) as User;
            if (
                updatedUser &&
                unlockAchievements(updatedUser, ['totalStats.oasesConquered'])
            ) {
                await this.dbAccessorService.getCollection(USERS_COLLECTION).updateOne(
                    { username: movement.senderUsername },
                    { $set: { unlockedAchievements: (updatedUser as any).unlockedAchievements } },
                );
            }
        } else {
            const survivingDefenders = new TroopsAmounts(
                Math.max(0, defenderTroops.spearFighters - killedDefenderTroops.spearFighters),
                Math.max(0, defenderTroops.swordFighters - killedDefenderTroops.swordFighters),
                Math.max(0, defenderTroops.axeFighters - killedDefenderTroops.axeFighters),
                Math.max(0, defenderTroops.archers - killedDefenderTroops.archers),
                Math.max(0, defenderTroops.magicians - killedDefenderTroops.magicians),
                Math.max(0, defenderTroops.horsemen - killedDefenderTroops.horsemen),
                Math.max(0, defenderTroops.catapults - killedDefenderTroops.catapults),
            );

            const survivingContribs = this.distributeSurvivorsAcrossContributions(
                defenderContributions, killedDefenderTroops,
            );

            const survivingStashSum = survivingContribs.reduce((sum, c) => ({
                wood: sum.wood + (c.stash?.wood || 0),
                stone: sum.stone + (c.stash?.stone || 0),
                crop: sum.crop + (c.stash?.crop || 0),
            }), { wood: 0, stone: 0, crop: 0 });
            const totalSurvivingStash = survivingStashSum.wood + survivingStashSum.stone + survivingStashSum.crop;
            const totalGarrisonStash = (garrison.stash.wood || 0) + (garrison.stash.stone || 0) + (garrison.stash.crop || 0);

            const updateFields: Record<string, any> = { 'garrison.contributions': survivingContribs };
            if (totalSurvivingStash > 0 && totalSurvivingStash >= totalGarrisonStash * 0.5) {
                updateFields['garrison.stash'] = survivingStashSum;
            }

            await this.dbAccessorService.getCollection(OASES_COLLECTION).updateOne(
                { _id: oasis._id },
                { $set: updateFields },
            );

            const oasisIdStr = oasis._id!.toHexString();
            const lostTroopCount =
                (movement.troops.spearFighters || 0) +
                (movement.troops.swordFighters || 0) +
                (movement.troops.axeFighters || 0) +
                (movement.troops.archers || 0) +
                (movement.troops.magicians || 0) +
                (movement.troops.horsemen || 0) +
                (movement.troops.catapults || 0);
            await this.dbAccessorService.getCollection(USERS_COLLECTION).updateOne(
                { username: movement.senderUsername, 'villages.villageName': movement.senderVillageName },
                { $inc: { 'villages.$.troopsInTransit': -lostTroopCount } },
            );
            for (const sc of survivingContribs) {
                const scTotal = getTotalTroopCount(sc.troops);
                if (scTotal > 0) {
                    await this.removeOasisTroopsTracking(garrison.username, sc.villageName, oasisIdStr);
                    await this.dbAccessorService.getCollection(USERS_COLLECTION).updateOne(
                        { username: garrison.username, 'villages.villageName': sc.villageName },
                        { $push: { 'villages.$.oasisTroopsSent': { oasisId: oasisIdStr, troops: sc.troops } } as any },
                    );
                } else {
                    await this.removeOasisTroopsTracking(garrison.username, sc.villageName, oasisIdStr);
                }
            }
        }

        attackerUser.weeklyStats = attackerUser.weeklyStats || {
            bossDamage: 0,
            resourcesStolen: 0,
            successfulDefenses: 0,
        };
        attackerUser.totalStats = attackerUser.totalStats || {
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

        if (attackWon) {
            attackerUser.totalStats.totalBattlesWon += 1;
            unlockAchievements(attackerUser, ['totalStats.totalBattlesWon']);
        }

        await this.dbAccessorService.getCollection(USERS_COLLECTION).updateOne(
            { username: attackerUser.username },
            {
                $set: {
                    weeklyStats: attackerUser.weeklyStats,
                    totalStats: attackerUser.totalStats,
                    unlockedAchievements: (attackerUser as any).unlockedAchievements,
                },
            },
        );
    }

    private async refundTroopsToVillage(
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

        village.troops.spearFighters = (village.troops.spearFighters || 0) + (troops.spearFighters || 0);
        village.troops.swordFighters = (village.troops.swordFighters || 0) + (troops.swordFighters || 0);
        village.troops.axeFighters = (village.troops.axeFighters || 0) + (troops.axeFighters || 0);
        village.troops.archers = (village.troops.archers || 0) + (troops.archers || 0);
        village.troops.magicians = (village.troops.magicians || 0) + (troops.magicians || 0);
        village.troops.horsemen = (village.troops.horsemen || 0) + (troops.horsemen || 0);
        village.troops.catapults = (village.troops.catapults || 0) + (troops.catapults || 0);

        const refundedCount =
            (troops.spearFighters || 0) + (troops.swordFighters || 0) +
            (troops.axeFighters || 0) + (troops.archers || 0) +
            (troops.magicians || 0) + (troops.horsemen || 0) +
            (troops.catapults || 0);
        village.troopsInTransit = Math.max(0, (village.troopsInTransit || 0) - refundedCount);

        await this.dbAccessorService.getCollection(USERS_COLLECTION).updateOne(
            { username },
            { $set: { villages: user.villages } },
        );
    }

    private async removeOasisTroopsTracking(
        username: string,
        villageName: string,
        oasisId: string,
    ): Promise<void> {
        await this.dbAccessorService.getCollection(USERS_COLLECTION).updateOne(
            { username, 'villages.villageName': villageName },
            { $pull: { 'villages.$.oasisTroopsSent': { oasisId } } as any },
        );
    }

    private async updateOasisTroopsTracking(
        username: string,
        villageName: string,
        oasisId: string,
        troops: TroopsAmounts,
    ): Promise<void> {
        await this.dbAccessorService.getCollection(USERS_COLLECTION).updateOne(
            { username },
            {
                $set: {
                    'villages.$[v].oasisTroopsSent.$[o].troops': troops,
                },
            },
            {
                arrayFilters: [
                    { 'v.villageName': villageName },
                    { 'o.oasisId': oasisId },
                ],
            } as any,
        );
    }

    private getResourcesForContrib(
        contrib: OasisGarrisonContribution,
        index: number,
        allContribs: OasisGarrisonContribution[],
        garrison: OasisGarrison,
    ): { wood: number; stone: number; crop: number } {
        const totalContribStash = allContribs.reduce(
            (sum, c) => sum + (c.stash?.wood || 0) + (c.stash?.stone || 0) + (c.stash?.crop || 0), 0,
        );
        const totalGarrisonStash = (garrison.stash.wood || 0) + (garrison.stash.stone || 0) + (garrison.stash.crop || 0);

        if (totalContribStash >= totalGarrisonStash * 0.5 && totalContribStash > 0) {
            const s = contrib.stash || { wood: 0, stone: 0, crop: 0 };
            return { wood: Math.floor(s.wood), stone: Math.floor(s.stone), crop: Math.floor(s.crop) };
        }

        const splits = this.splitResourcesByContributions(
            allContribs,
            Math.floor(garrison.stash.wood || 0),
            Math.floor(garrison.stash.stone || 0),
            Math.floor(garrison.stash.crop || 0),
        );
        return splits[index] || { wood: 0, stone: 0, crop: 0 };
    }

    private splitResourcesByContributions(
        contributions: OasisGarrisonContribution[],
        totalWood: number,
        totalStone: number,
        totalCrop: number,
    ): { wood: number; stone: number; crop: number }[] {
        if (contributions.length === 0) return [];
        if (contributions.length === 1) {
            return [{ wood: totalWood, stone: totalStone, crop: totalCrop }];
        }

        const troopCounts = contributions.map(c => getTotalTroopCount(c.troops));
        const grandTotal = troopCounts.reduce((a, b) => a + b, 0);
        if (grandTotal <= 0) {
            const equal = contributions.map(() => ({ wood: 0, stone: 0, crop: 0 }));
            equal[0] = { wood: totalWood, stone: totalStone, crop: totalCrop };
            return equal;
        }

        const splits: { wood: number; stone: number; crop: number }[] = [];
        let woodLeft = totalWood;
        let stoneLeft = totalStone;
        let cropLeft = totalCrop;

        for (let i = 0; i < contributions.length; i++) {
            if (i === contributions.length - 1) {
                splits.push({ wood: woodLeft, stone: stoneLeft, crop: cropLeft });
            } else {
                const ratio = troopCounts[i] / grandTotal;
                const w = Math.floor(totalWood * ratio);
                const s = Math.floor(totalStone * ratio);
                const c = Math.floor(totalCrop * ratio);
                splits.push({ wood: w, stone: s, crop: c });
                woodLeft -= w;
                stoneLeft -= s;
                cropLeft -= c;
            }
        }

        return splits;
    }

    private distributeSurvivorsAcrossContributions(
        contributions: OasisGarrisonContribution[],
        killed: TroopsAmounts,
    ): OasisGarrisonContribution[] {
        const troopTypes = ['spearFighters', 'swordFighters', 'axeFighters', 'archers', 'magicians', 'horsemen', 'catapults'] as const;
        const result: OasisGarrisonContribution[] = contributions.map(c => ({
            villageName: c.villageName,
            troops: { ...c.troops },
            stash: c.stash ? { ...c.stash } : { wood: 0, stone: 0, crop: 0 },
        }));

        for (const type of troopTypes) {
            let killsRemaining = killed[type] || 0;
            if (killsRemaining <= 0) continue;

            const totalOfType = contributions.reduce((sum, c) => sum + (c.troops[type] || 0), 0);
            if (totalOfType <= 0) continue;

            for (const r of result) {
                const share = Math.floor(killsRemaining * ((r.troops[type] || 0) / totalOfType));
                r.troops[type] = Math.max(0, (r.troops[type] || 0) - share);
            }

            const actualKilled = contributions.reduce((sum, c, i) => sum + ((c.troops[type] || 0) - (result[i].troops[type] || 0)), 0);
            let leftover = killsRemaining - actualKilled;
            for (let i = result.length - 1; i >= 0 && leftover > 0; i--) {
                const canKill = Math.min(leftover, result[i].troops[type] || 0);
                result[i].troops[type] -= canKill;
                leftover -= canKill;
            }
        }

        return result.filter(c => getTotalTroopCount(c.troops) > 0);
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

    private calculateDefence(troops: TroopsAmounts): number {
        return (
            (troops.spearFighters || 0) * spearFighterDefenceStat +
            (troops.swordFighters || 0) * swordFighterDefenceStat +
            (troops.axeFighters || 0) * axeFighterDefenceStat +
            (troops.archers || 0) * archerDefenceStat +
            (troops.magicians || 0) * magicianDefenceStat +
            (troops.horsemen || 0) * horsemenDefenceStat +
            (troops.catapults || 0) * catapultsDefenceStat
        );
    }

    private calculateGarrisonDefenceWithVillageBonuses(
        contributions: OasisGarrisonContribution[],
        defenderUser: User | null,
    ): number {
        return contributions.reduce((sum, contribution) => {
            const troops = new TroopsAmounts(
                contribution.troops.spearFighters || 0,
                contribution.troops.swordFighters || 0,
                contribution.troops.axeFighters || 0,
                contribution.troops.archers || 0,
                contribution.troops.magicians || 0,
                contribution.troops.horsemen || 0,
                contribution.troops.catapults || 0,
            );
            const baseDefence = this.calculateDefence(troops);
            const village = defenderUser?.villages.find(
                (v) => v.villageName === contribution.villageName,
            );
            const heroicShieldBonus = village
                ? getSkillBonus(village.skills, SkillCategory.HEROIC_SHIELD)
                : 0;
            return sum + Math.floor(baseDefence * (1 + heroicShieldBonus));
        }, 0);
    }

    private calculateKilledTroopsByRatio(
        troops: TroopsAmounts,
        ratio: number,
    ): TroopsAmounts {
        if (ratio > 1 || ratio < 0) {
            return new TroopsAmounts(0, 0, 0, 0, 0, 0, 0);
        }
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

    private hasTroopsToSend(troops: TroopsAmounts): boolean {
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
        requested: TroopsAmounts,
        available: TroopsAmounts,
    ): boolean {
        return (
            (requested.spearFighters || 0) <= (available.spearFighters || 0) &&
            (requested.swordFighters || 0) <= (available.swordFighters || 0) &&
            (requested.axeFighters || 0) <= (available.axeFighters || 0) &&
            (requested.archers || 0) <= (available.archers || 0) &&
            (requested.magicians || 0) <= (available.magicians || 0) &&
            (requested.horsemen || 0) <= (available.horsemen || 0) &&
            (requested.catapults || 0) <= (available.catapults || 0)
        );
    }
}

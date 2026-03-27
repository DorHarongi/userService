import { Injectable } from '@nestjs/common';
import { User } from '../user/models/user.entity';
import {
    ClanQuestDefinition,
    selectClanQuest,
    getClanQuestWeekSeed,
    ClanQuestTrackingType,
    warehouseStorageByLevel,
    scaleQuestReward,
    scaleClanQuestTarget,
    ClanScalingData,
} from 'utils';
import { computeClanTotalStrength } from '../user/strength-utils';
import { DbAccessorService } from '../database/services/db-accessor.service';

const USERS_COLLECTION = 'users';
const CLANS_COLLECTION = 'clans';
const CLAN_QUEST_PROGRESS_COLLECTION = 'clanQuestProgress';

export interface ClanQuestProgressDoc {
    clanName: string;
    weekSeed: number;
    questId: string;
    progress: number;
    completedAt?: Date;
    contributions: { username: string; amount: number }[];
    scalingData: ClanScalingData;
    scaledTarget: number;
}

export interface ClanQuestStatusResponse {
    quest: ClanQuestDefinition;
    clanProgress: ClanQuestProgressDoc | null;
    canClaim: boolean;
    alreadyClaimed: boolean;
    clanCompleted: boolean;
}

@Injectable()
export class ClanQuestService {
    constructor(private dbAccessorService: DbAccessorService) {}

    getThisWeeksQuest(): ClanQuestDefinition {
        const seed = getClanQuestWeekSeed();
        return selectClanQuest(seed);
    }

    async getClanProgress(clanName: string): Promise<ClanQuestProgressDoc | null> {
        const weekSeed = getClanQuestWeekSeed();
        const doc = (await this.dbAccessorService
            .getCollection(CLAN_QUEST_PROGRESS_COLLECTION)
            .findOne({ clanName, weekSeed })) as unknown as ClanQuestProgressDoc | null;
        return doc;
    }

    async computeClanScalingData(clanName: string): Promise<ClanScalingData> {
        const clan = await this.dbAccessorService
            .getCollection(CLANS_COLLECTION)
            .findOne({ clanName }) as any;
        if (!clan?.members?.length) {
            return { totalAttackPower: 0, totalPopulation: 0, memberCount: 1 };
        }

        const totalAttackPower = await computeClanTotalStrength(
            this.dbAccessorService, clan.members,
        );

        const members = await this.dbAccessorService
            .getCollection(USERS_COLLECTION)
            .find({ username: { $in: clan.members } })
            .project({ villages: 1 })
            .toArray();

        let totalPopulation = 0;
        for (const member of members) {
            for (const v of (member.villages || [])) {
                totalPopulation += v.population || 0;
            }
        }

        return {
            totalAttackPower,
            totalPopulation,
            memberCount: clan.members.length,
        };
    }

    async incrementClanProgress(
        clanName: string,
        username: string,
        trackingType: ClanQuestTrackingType,
        amount: number,
    ): Promise<void> {
        const weekSeed = getClanQuestWeekSeed();
        const quest = this.getThisWeeksQuest();

        if (quest.trackingType !== trackingType) return;

        const existing = (await this.dbAccessorService
            .getCollection(CLAN_QUEST_PROGRESS_COLLECTION)
            .findOne({ clanName, weekSeed })) as unknown as ClanQuestProgressDoc | null;

        const collection = this.dbAccessorService.getCollection(CLAN_QUEST_PROGRESS_COLLECTION);

        if (!existing) {
            const scalingData = await this.computeClanScalingData(clanName);
            const scaledTarget = scaleClanQuestTarget(quest, scalingData);

            const newDoc: ClanQuestProgressDoc = {
                clanName,
                weekSeed,
                questId: quest.id,
                progress: Math.min(Math.max(0, amount), scaledTarget),
                contributions: [{ username, amount: Math.max(0, amount) }],
                scalingData,
                scaledTarget,
            };
            if (newDoc.progress >= scaledTarget) {
                newDoc.completedAt = new Date();
            }
            await collection.insertOne(newDoc);
            return;
        }

        const target = existing.scaledTarget;

        const contributionEntry = existing.contributions.find((c) => c.username === username);
        const currentUserAmount = contributionEntry?.amount ?? 0;
        const newUserAmount = Math.max(0, currentUserAmount + amount);
        const totalProgress = Math.max(0, existing.progress + amount);

        const newContributions = existing.contributions.filter((c) => c.username !== username);
        newContributions.push({ username, amount: newUserAmount });

        const updateDoc: Partial<ClanQuestProgressDoc> = {
            progress: Math.min(totalProgress, target),
            contributions: newContributions,
        };

        if (totalProgress >= target && !existing.completedAt) {
            updateDoc.completedAt = new Date();
        }

        await collection.updateOne({ clanName, weekSeed }, { $set: updateDoc });
    }

    async claimClanQuestReward(username: string, villageIndex: number): Promise<User | null> {
        const user = (await this.dbAccessorService
            .getCollection(USERS_COLLECTION)
            .findOne({ username })) as User;
        if (!user) return null;

        if (!user.clanName || user.clanName === '') return null;

        const currentWeekSeed = getClanQuestWeekSeed();
        if (user.clanQuestRewardClaimedWeek === currentWeekSeed) return null;

        const clanProgress = await this.getClanProgress(user.clanName);
        if (!clanProgress || !clanProgress.completedAt) return null;

        const hasContributed = clanProgress.contributions.some((c) => c.username === username);
        if (!hasContributed) return null;

        const quest = this.getThisWeeksQuest();
        if (clanProgress.questId !== quest.id) return null;

        const village = user.villages[villageIndex];
        if (!village) return null;

        const maxWood = warehouseStorageByLevel[village.buildingsLevels.woodWarehouseLevel];
        const maxStone = warehouseStorageByLevel[village.buildingsLevels.stoneWarehouseLevel];
        const maxCrop = warehouseStorageByLevel[village.buildingsLevels.cropWarehouseLevel];

        const lowestWarehouse = Math.min(maxWood || 5000, maxStone || 5000, maxCrop || 5000);
        const scaledReward = scaleQuestReward(quest.reward, lowestWarehouse);

        village.resourcesAmounts.woodAmount = Math.min(
            village.resourcesAmounts.woodAmount + scaledReward.wood,
            maxWood,
        );
        village.resourcesAmounts.stonesAmount = Math.min(
            village.resourcesAmounts.stonesAmount + scaledReward.stone,
            maxStone,
        );
        village.resourcesAmounts.cropAmount = Math.min(
            village.resourcesAmounts.cropAmount + scaledReward.crop,
            maxCrop,
        );

        await this.dbAccessorService.getCollection(USERS_COLLECTION).updateOne(
            { username },
            {
                $set: {
                    clanQuestRewardClaimedWeek: currentWeekSeed,
                    villages: user.villages,
                },
            },
        );

        return user;
    }

    async getClanQuestStatus(username: string): Promise<ClanQuestStatusResponse | null> {
        const user = (await this.dbAccessorService
            .getCollection(USERS_COLLECTION)
            .findOne({ username })) as User;
        if (!user) return null;

        if (!user.clanName || user.clanName === '') return null;

        const quest = this.getThisWeeksQuest();
        const clanProgress = await this.getClanProgress(user.clanName);

        const currentWeekSeed = getClanQuestWeekSeed();
        const alreadyClaimed = user.clanQuestRewardClaimedWeek === currentWeekSeed;
        const clanCompleted = !!(clanProgress?.completedAt);
        const hasContributed = clanProgress?.contributions.some((c) => c.username === username) ?? false;
        const canClaim =
            clanCompleted &&
            !alreadyClaimed &&
            hasContributed &&
            clanProgress?.questId === quest.id;

        return {
            quest,
            clanProgress,
            canClaim,
            alreadyClaimed,
            clanCompleted,
        };
    }
}

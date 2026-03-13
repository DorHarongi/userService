import { Injectable } from '@nestjs/common';
import { User } from '../user/models/user.entity';
import {
    DailyQuestDefinition,
    selectDailyQuests,
    getDailyQuestSeed,
    TOTAL_QUESTS,
    warehouseStorageByLevel,
    scaleQuestReward,
    scaleQuestTarget,
    DailyQuestTrackingType,
    spearFighterAttackingStat,
    swordFighterAttackingStat,
    axeFighterAttackingStat,
    archerAttackingStat,
    magicianAttackingStat,
    horsemenAttackingStat,
    catapultsAttackingStat,
} from 'utils';
import { DbAccessorService } from '../database/services/db-accessor.service';

const USERS_COLLECTION = 'users';

@Injectable()
export class DailyQuestService {
    constructor(private dbAccessorService: DbAccessorService) {}

    getTodaysQuests(): DailyQuestDefinition[] {
        const seed = getDailyQuestSeed();
        return selectDailyQuests(seed);
    }

    getTodaysDateString(): string {
        const now = new Date();
        const year = now.getUTCFullYear();
        const month = String(now.getUTCMonth() + 1).padStart(2, '0');
        const day = String(now.getUTCDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    getPlayerDailyProgress(user: User): { questId: string; progress: number; claimed: boolean }[] {
        const todaysDateString = this.getTodaysDateString();
        if (user.dailyQuestProgress?.date !== todaysDateString) {
            const quests = this.getTodaysQuests();
            return quests.map((q) => ({ questId: q.id, progress: 0, claimed: false }));
        }
        const quests = this.getTodaysQuests();
        const existingMap = new Map(
            user.dailyQuestProgress!.quests.map((p) => [p.questId, p]),
        );
        return quests.map((q) => {
            const existing = existingMap.get(q.id);
            return existing
                ? { ...existing, questId: q.id }
                : { questId: q.id, progress: 0, claimed: false };
        });
    }

    async incrementProgress(
        username: string,
        trackingType: DailyQuestTrackingType,
        amount: number,
    ): Promise<void> {
        const user = (await this.dbAccessorService
            .getCollection(USERS_COLLECTION)
            .findOne({ username })) as User;
        if (!user) return;

        if (!this.isDailyQuestAvailable(user)) return;

        const todaysDateString = this.getTodaysDateString();
        const quests = this.getTodaysQuests();
        const matchingQuests = quests.filter((q) => q.trackingType === trackingType);
        if (matchingQuests.length === 0) return;

        const progress = this.getPlayerDailyProgress(user);

        for (const quest of matchingQuests) {
            const idx = quests.findIndex((q) => q.id === quest.id);
            if (idx >= 0 && progress[idx] && !progress[idx].claimed) {
                progress[idx].progress = Math.max(0, progress[idx].progress + amount);
            }
        }

        await this.dbAccessorService.getCollection(USERS_COLLECTION).updateOne(
            { username },
            {
                $set: {
                    dailyQuestProgress: {
                        date: todaysDateString,
                        quests: progress,
                    },
                },
            },
        );
    }

    async claimDailyQuest(
        username: string,
        questId: string,
        villageIndex: number,
    ): Promise<User | null> {
        const user = (await this.dbAccessorService
            .getCollection(USERS_COLLECTION)
            .findOne({ username })) as User;
        if (!user) return null;

        if (!this.isDailyQuestAvailable(user)) return null;

        const quests = this.getTodaysQuests();
        const quest = quests.find((q) => q.id === questId);
        if (!quest) return null;

        const progress = this.getPlayerDailyProgress(user);
        const questIds = quests.map((q) => q.id);
        const idx = questIds.indexOf(questId);
        if (idx < 0) return null;

        let totalAttackPower = 0;
        for (const v of user.villages) {
            const t = v.troops;
            totalAttackPower +=
                (t.spearFighters || 0) * spearFighterAttackingStat +
                (t.swordFighters || 0) * swordFighterAttackingStat +
                (t.axeFighters || 0) * axeFighterAttackingStat +
                (t.archers || 0) * archerAttackingStat +
                (t.magicians || 0) * magicianAttackingStat +
                (t.horsemen || 0) * horsemenAttackingStat +
                (t.catapults || 0) * catapultsAttackingStat;
        }
        const scaledTarget = scaleQuestTarget(quest.target, quest.trackingType, totalAttackPower);

        const entry = progress[idx];
        if (!entry || entry.claimed || entry.progress < scaledTarget) return null;

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

        entry.claimed = true;

        const todaysDateString = this.getTodaysDateString();
        await this.dbAccessorService.getCollection(USERS_COLLECTION).updateOne(
            { username },
            {
                $set: {
                    dailyQuestProgress: {
                        date: todaysDateString,
                        quests: progress,
                    },
                    villages: user.villages,
                },
            },
        );

        return user;
    }

    isDailyQuestAvailable(user: User): boolean {
        return (user.currentQuestIndex ?? 1) > TOTAL_QUESTS;
    }
}

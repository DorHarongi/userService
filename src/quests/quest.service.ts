import { Injectable } from '@nestjs/common';
import { User } from '../user/models/user.entity';
import { Village } from '../user/models/village.entity';
import { 
    Quest, 
    QuestCompletionResult, 
    QuestCompletionType, 
    QuestAction, 
    QUESTS, 
    getQuestByIndex, 
    TOTAL_QUESTS,
    warehouseStorageByLevel
} from 'utils';

@Injectable()
export class QuestService {

    /**
     * Check if the given action completes the user's current quest.
     * If so, apply rewards and advance to next quest.
     * 
     * @param user The user object (will be modified if quest completes)
     * @param action The action that was performed
     * @param villageIndex The village index where the action occurred
     * @returns QuestCompletionResult if quest was completed, null otherwise
     */
    checkAndCompleteQuest(user: User, action: QuestAction, villageIndex: number): QuestCompletionResult | null {
        // Quests only available for first village
        if (villageIndex !== 0) return null;
        
        // Check if user has valid quest index
        const currentQuestIndex = user.currentQuestIndex || 1;
        if (currentQuestIndex < 1 || currentQuestIndex > TOTAL_QUESTS) return null;

        const currentQuest = getQuestByIndex(currentQuestIndex);
        if (!currentQuest) return null;

        const village = user.villages[0];
        if (!village) return null;

        // Check if the action completes the current quest
        if (this.isQuestCompleted(currentQuest, action, village)) {
            return this.completeQuest(user, currentQuest);
        }

        return null;
    }

    /**
     * Check if a quest's conditions are met based on the action and current village state
     */
    private isQuestCompleted(quest: Quest, action: QuestAction, village: Village): boolean {
        const condition = quest.condition;

        switch (condition.type) {
            case QuestCompletionType.BUILDING_LEVEL:
                // Action must be building upgrade with matching building and level
                return action.type === 'UPGRADE_BUILDING' &&
                       action.buildingName === condition.buildingName &&
                       action.newLevel !== undefined &&
                       action.newLevel >= (condition.level || 0);

            case QuestCompletionType.TRAIN_TROOPS:
                // Check total troops in village
                if (action.type !== 'TRAIN_TROOPS') return false;
                const totalTroops = this.countTotalTroops(village);
                return totalTroops >= (condition.count || 0);

            case QuestCompletionType.HIRE_WORKERS:
                // Check total workers in village
                if (action.type !== 'HIRE_WORKERS') return false;
                const totalWorkers = this.countTotalWorkers(village);
                return totalWorkers >= (condition.count || 0);

            default:
                return false;
        }
    }

    /**
     * Complete a quest: add rewards (capped by warehouse) and advance to next quest
     */
    private completeQuest(user: User, quest: Quest): QuestCompletionResult {
        const village = user.villages[0];

        // Get warehouse capacities
        const maxWood = warehouseStorageByLevel[village.buildingsLevels.woodWarehouseLevel];
        const maxStone = warehouseStorageByLevel[village.buildingsLevels.stoneWarehouseLevel];
        const maxCrop = warehouseStorageByLevel[village.buildingsLevels.cropWarehouseLevel];

        // Add rewards to first village (capped by warehouse capacity)
        village.resourcesAmounts.woodAmount = Math.min(
            village.resourcesAmounts.woodAmount + quest.rewards.wood,
            maxWood
        );
        village.resourcesAmounts.stonesAmount = Math.min(
            village.resourcesAmounts.stonesAmount + quest.rewards.stone,
            maxStone
        );
        village.resourcesAmounts.cropAmount = Math.min(
            village.resourcesAmounts.cropAmount + quest.rewards.crop,
            maxCrop
        );

        // Advance to next quest
        user.currentQuestIndex = (user.currentQuestIndex || 1) + 1;

        // Get next quest (or null if completed all)
        const nextQuest = user.currentQuestIndex <= TOTAL_QUESTS 
            ? getQuestByIndex(user.currentQuestIndex) 
            : null;

        return {
            completedQuestId: quest.id,
            completedQuestTitle: quest.title,
            rewards: quest.rewards,
            nextQuest: nextQuest || null
        };
    }

    /**
     * Count total troops in a village
     */
    private countTotalTroops(village: Village): number {
        const troops = village.troops;
        if (!troops) return 0;
        
        return (troops.spearFighters || 0) + 
               (troops.swordFighters || 0) + 
               (troops.axeFighters || 0) + 
               (troops.archers || 0) + 
               (troops.magicians || 0) + 
               (troops.horsemen || 0) + 
               (troops.catapults || 0);
    }

    /**
     * Count total workers in a village
     */
    private countTotalWorkers(village: Village): number {
        const workers = village.resourcesWorkers;
        if (!workers) return 0;
        
        return (workers.woodWorkers || 0) + 
               (workers.stoneWorkers || 0) + 
               (workers.cropWorkers || 0);
    }
}

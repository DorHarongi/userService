import { User, PendingBossReward } from "../models/user.entity";
import { VillageDTO } from "./villageDTO";
import { getSkillBonus, SkillCategory } from 'utils';

const BEGINNER_SHIELD_HOURS = 24;

export class UserDTO {
    username: string;
    joinDate: Date;
    clanName: string;
    villages: VillageDTO[];
    energy: number;
    pendingClanRequests: string[];
    intro: string;
    currentQuestIndex: number;
    pendingBossRewards: PendingBossReward[];
    beginnerShieldRemainingHours: number;
    energyProductionMultiplier: number;
    weeklyStats?: {
        bossDamage: number;
        resourcesStolen: number;
        successfulDefenses: number;
    };
    totalStats?: {
        lifetimeBossDamage: number;
        lifetimeResourcesStolen: number;
        totalBattlesWon: number;
        successfulSpies: number;
        relicsStolen: number;
        resourcesSentToClan: number;
        mythicBossDamage: number;
        supportTroopsSent: number;
        oasesConquered: number;
    };
    selectedTitle?: string;
    unlockedAchievements?: string[];
    theme?: string;
    dailyQuestProgress?: {
        date: string;
        quests: { questId: string; progress: number; claimed: boolean }[];
    };
    clanQuestRewardClaimedWeek?: number;

    constructor(user: User) {
        this.username = user.username;
        this.joinDate = user.joinDate;
        this.clanName = user.clanName;
        this.energy = user.energy;
        this.pendingClanRequests = user.pendingClanRequests || [];
        this.intro = user.intro || '';
        this.currentQuestIndex = user.currentQuestIndex || 1; // Default to 1 for backwards compatibility
        this.pendingBossRewards = user.pendingBossRewards || [];
        this.beginnerShieldRemainingHours = this.calculateBeginnerShieldRemaining(user);
        this.energyProductionMultiplier = this.calculateEnergyProductionMultiplier(user);
        this.weeklyStats = user.weeklyStats;
        this.totalStats = user.totalStats;
        this.selectedTitle = user.selectedTitle;
        this.unlockedAchievements = user.unlockedAchievements || [];
        this.theme = user.theme ?? 'default';
        this.dailyQuestProgress = user.dailyQuestProgress;
        this.clanQuestRewardClaimedWeek = user.clanQuestRewardClaimedWeek;
        this.villages = [];
        for (const village of user.villages) {
            this.villages.push(new VillageDTO(village));
        }
    }

    private calculateBeginnerShieldRemaining(user: User): number {
        if (!user.joinDate) return 0;
        const now = new Date();
        const joinDate = new Date(user.joinDate);
        const hoursSinceJoin = (now.getTime() - joinDate.getTime()) / (1000 * 60 * 60);
        return Math.max(0, BEGINNER_SHIELD_HOURS - hoursSinceJoin);
    }

    // Calculate energy production multiplier from Adrenaline Surge skill on any village (best one wins)
    private calculateEnergyProductionMultiplier(user: User): number {
        let bestMultiplier = 1.0;

        for (const village of user.villages) {
            if (!village.skills) continue;
            const adrenalineBonus = getSkillBonus(village.skills, SkillCategory.ADRENALINE_SURGE);
            const multiplier = 1 + adrenalineBonus;
            if (multiplier > bestMultiplier) {
                bestMultiplier = multiplier;
            }
        }

        return bestMultiplier;
    }
}

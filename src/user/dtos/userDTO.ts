import { User, PendingBossReward } from "../models/user.entity";
import { VillageDTO } from "./villageDTO";
import { getSkillBonus, SkillCategory } from 'utils';
import { RelicDocument } from '../../relics/relics.service';

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

    constructor(user: User, allRelics: RelicDocument[] = []) {
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
            const villageRelicIds = allRelics
                .filter(r => r.holderUsername === user.username && r.holderVillageName === village.villageName)
                .map(r => r.relicId);
            this.villages.push(new VillageDTO(village, villageRelicIds));
        }
    }

    private calculateBeginnerShieldRemaining(user: User): number {
        if (!user.joinDate) return 0;
        const now = new Date();
        const joinDate = new Date(user.joinDate);
        const hoursSinceJoin = (now.getTime() - joinDate.getTime()) / (1000 * 60 * 60);
        return Math.max(0, BEGINNER_SHIELD_HOURS - hoursSinceJoin);
    }

    // Calculate energy production multiplier from Adrenaline Surge skill (stacks across all villages)
    private calculateEnergyProductionMultiplier(user: User): number {
        let totalBonus = 0;

        for (const village of user.villages) {
            if (!village.skills) continue;
            totalBonus += getSkillBonus(village.skills, SkillCategory.ADRENALINE_SURGE);
        }

        return 1 + totalBonus;
    }
}

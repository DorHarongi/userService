import { User, PendingBossReward } from "../models/user.entity";
import { VillageDTO } from "./villageDTO";

const BEGINNER_SHIELD_HOURS = 24;

export class UserDTO
{
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

    constructor(user: User)
    {
        this.username = user.username;
        this.joinDate = user.joinDate;
        this.clanName = user.clanName;
        this.energy = user.energy;
        this.pendingClanRequests = user.pendingClanRequests || [];
        this.intro = user.intro || '';
        this.currentQuestIndex = user.currentQuestIndex || 1; // Default to 1 for backwards compatibility
        this.pendingBossRewards = user.pendingBossRewards || [];
        this.beginnerShieldRemainingHours = this.calculateBeginnerShieldRemaining(user);
        this.villages = [];
        for(let village of user.villages)
        {
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
}


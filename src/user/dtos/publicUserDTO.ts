import { User } from "../models/user.entity";

const BEGINNER_SHIELD_HOURS = 24;

export interface PublicVillageDTO {
    villageName: string;
    population: number;
    location: { x: number; y: number };
}

export class PublicUserDTO {
    username: string;
    joinDate: Date;
    clanName: string;
    villages: PublicVillageDTO[];
    beginnerShieldRemainingHours: number;
    intro: string;
    selectedTitle?: string;

    constructor(user: User) {
        this.username = user.username;
        this.joinDate = user.joinDate;
        this.clanName = user.clanName;
        this.beginnerShieldRemainingHours = this.calculateBeginnerShieldRemaining(user);
        this.intro = user.intro || '';
        this.selectedTitle = user.selectedTitle;
        this.villages = (user.villages || []).map(v => ({
            villageName: v.villageName,
            population: v.population,
            location: { x: v.location?.x || 0, y: v.location?.y || 0 },
        }));
    }

    private calculateBeginnerShieldRemaining(user: User): number {
        if (!user.joinDate) return 0;
        const now = new Date();
        const joinDate = new Date(user.joinDate);
        const hoursSinceJoin = (now.getTime() - joinDate.getTime()) / (1000 * 60 * 60);
        return Math.max(0, BEGINNER_SHIELD_HOURS - hoursSinceJoin);
    }
}

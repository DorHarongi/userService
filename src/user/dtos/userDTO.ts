import { User } from "../models/user.entity";
import { VillageDTO } from "./villageDTO";

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

    constructor(user: User)
    {
        this.username = user.username;
        this.joinDate = user.joinDate;
        this.clanName = user.clanName;
        this.energy = user.energy;
        this.pendingClanRequests = user.pendingClanRequests || [];
        this.intro = user.intro || '';
        this.currentQuestIndex = user.currentQuestIndex || 1; // Default to 1 for backwards compatibility
        this.villages = [];
        for(let village of user.villages)
        {
            this.villages.push(new VillageDTO(village));
        }
    }
}


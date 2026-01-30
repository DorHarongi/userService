import { ObjectId } from "mongodb";
import { IUser } from "./IUser.interface";
import { userFromClientDTO } from "../dtos/userFromClientDTO";
import { Village } from "./village.entity";
import { Location } from "./location";
import { maxEnergy, TOTAL_QUESTS } from 'utils'

export class User implements IUser
{
    _id: ObjectId;
    username: string;
    password: string;
    joinDate: Date;
    clanName: string;
    villages: Village[];
    energy: number;
    pendingClanRequests: string[]; // clan names user has requested to join
    intro: string; // player bio/intro, max 200 characters
    currentQuestIndex: number; // 1-15 = on that quest, > TOTAL_QUESTS = completed all (only for first village)

    constructor(userFromClientDTO: userFromClientDTO, initialLocation: Location = new Location(0, 0))
    {
        this.username = userFromClientDTO.username;
        this.password = userFromClientDTO.password;
        this.joinDate = new Date();
        this.clanName = "";
        this.villages = [new Village("New Village", initialLocation)];
        this.energy = maxEnergy;
        this.pendingClanRequests = [];
        this.intro = "";
        this.currentQuestIndex = 1; // Start at quest 1
    }
}
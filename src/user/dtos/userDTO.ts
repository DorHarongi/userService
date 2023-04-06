import { User } from "../models/user.entity";
import { VillageDTO } from "./villageDTO";

export class UserDTO
{
    username: string;
    joinDate: Date;
    clanName: string;
    villages: VillageDTO[];
    energy: number;

    constructor(user: User)
    {
        this.username = user.username;
        this.joinDate = user.joinDate;
        this.clanName = user.clanName;
        this.energy = user.energy;
        this.villages = [];
        for(let village of user.villages)
        {
            this.villages.push(new VillageDTO(village));
        }
    }
}


import { VillageDTO } from "./villageDTO";

export class UserDTO
{
    username: string;
    joinDate: Date;
    clanName: string;
    villages: VillageDTO[];
}
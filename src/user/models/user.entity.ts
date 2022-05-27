import { ObjectId } from "mongodb";
import { IUser } from "./IUser.interface";
import { userFromClientDTO } from "../dtos/userFromClientDTO";
import { Village } from "./village.entity";

export class User implements IUser
{
    _id: ObjectId;
    username: string;
    password: string;
    joinDate: Date;
    clanName: string;
    villages: Village[];
    constructor(userFromClientDTO: userFromClientDTO)
    {
        this.username = userFromClientDTO.username;
        this.password = userFromClientDTO.password;
        this.joinDate = new Date();
        this.clanName = "";
        this.villages = [new Village()];
    }
}
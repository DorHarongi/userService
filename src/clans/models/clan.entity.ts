import { ObjectId } from "mongodb";

export interface ClanJoinRequest {
    username: string;
    message: string;
    requestDate: Date;
}

export interface IClan {
    _id?: ObjectId;
    clanName: string;
    description: string;
    leaderUsername: string;
    members: string[]; // usernames
    isOpen: boolean;
    pendingRequests: ClanJoinRequest[];
    createdDate: Date;
}

export class Clan implements IClan {
    _id?: ObjectId;
    clanName: string;
    description: string;
    leaderUsername: string;
    members: string[];
    isOpen: boolean;
    pendingRequests: ClanJoinRequest[];
    createdDate: Date;

    constructor(clanName: string, description: string, leaderUsername: string, isOpen: boolean = true) {
        this.clanName = clanName;
        this.description = description;
        this.leaderUsername = leaderUsername;
        this.members = [leaderUsername];
        this.isOpen = isOpen;
        this.pendingRequests = [];
        this.createdDate = new Date();
    }
}

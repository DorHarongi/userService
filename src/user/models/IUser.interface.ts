import { Village } from "./village.entity";
import type { WithId, Document } from 'mongodb'

export interface IUser extends WithId<Document>
{
    username: string;
    joinDate: Date;
    clanName: string; 
    villages: Array<Village>;
}
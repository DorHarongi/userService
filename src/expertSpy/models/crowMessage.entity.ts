import { ObjectId } from 'mongodb';

export interface CrowMessage {
    _id?: ObjectId;
    ownerUsername: string;
    ownerVillageName: string;
    missionId: ObjectId;
    content: string;
    departureTime: Date;
    arrivalTime: Date;
    status: 'in_transit' | 'delivered';
}

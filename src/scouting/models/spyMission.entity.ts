import { ObjectId } from "mongodb";

export type SpyMissionStatus = 'in_transit' | 'returning' | 'completed' | 'caught';
export type SpyMissionTarget = 'village' | 'oasis';

export class SpyMission {
    _id?: ObjectId;
    attackerUsername: string;
    attackerVillageName: string;
    defenderUsername: string;
    defenderVillageName: string;
    departureTime: Date;
    arrivalTime: Date;
    status: SpyMissionStatus;
    targetType?: SpyMissionTarget;
    oasisId?: string;
    oasisX?: number;
    oasisY?: number;
    oasisName?: string;
}


import { ObjectId } from 'mongodb';

export interface ExpertSpyMission {
    _id?: ObjectId;
    ownerUsername: string;
    ownerVillageName: string;
    targetUsername?: string;
    targetVillageName?: string;
    targetType: 'village' | 'oasis';
    targetOasisId?: string;
    status: 'deploying' | 'embedded' | 'returning' | 'caught' | 'completed';
    deployedAt: Date;
    arrivalTime: Date;
    embedExpiresAt?: Date;
    deathCooldownUntil?: Date;
}

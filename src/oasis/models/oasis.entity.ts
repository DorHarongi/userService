import { ObjectId } from 'mongodb';
import { OasisTier } from 'utils';

export interface OasisGarrison {
    username: string;
    villageName: string;
    troops: {
        spearFighters: number;
        swordFighters: number;
        axeFighters: number;
        archers: number;
        magicians: number;
        horsemen: number;
        catapults: number;
    };
    stash: {
        wood: number;
        stone: number;
        crop: number;
    };
    garrisonedAt: Date;
}

export interface Oasis {
    _id?: ObjectId;
    x: number;
    y: number;
    tier: OasisTier;
    resourcesRemaining: {
        wood: number;
        stone: number;
        crop: number;
    };
    garrison?: OasisGarrison;
    spawnedAt: Date;
    lastHarvestTick: Date;
}

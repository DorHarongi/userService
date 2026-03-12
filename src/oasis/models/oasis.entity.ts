import { ObjectId } from 'mongodb';
import { OasisTier } from 'utils';

export interface OasisGarrisonContribution {
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
}

export interface OasisGarrison {
    username: string;
    contributions: OasisGarrisonContribution[];
    stash: {
        wood: number;
        stone: number;
        crop: number;
    };
    totalForOccupier: {
        wood: number;
        stone: number;
        crop: number;
    };
    garrisonedAt: Date;
    /** @deprecated kept for backward compat with old DB documents */
    villageName?: string;
    /** @deprecated kept for backward compat with old DB documents */
    troops?: {
        spearFighters: number;
        swordFighters: number;
        axeFighters: number;
        archers: number;
        magicians: number;
        horsemen: number;
        catapults: number;
    };
}

export function getGarrisonContributions(garrison: OasisGarrison): OasisGarrisonContribution[] {
    if (garrison.contributions && garrison.contributions.length > 0) {
        return garrison.contributions;
    }
    if (garrison.villageName && garrison.troops) {
        return [{ villageName: garrison.villageName, troops: { ...garrison.troops } }];
    }
    return [];
}

export function getTotalGarrisonTroops(garrison: OasisGarrison): {
    spearFighters: number; swordFighters: number; axeFighters: number;
    archers: number; magicians: number; horsemen: number; catapults: number;
} {
    const contribs = getGarrisonContributions(garrison);
    const total = { spearFighters: 0, swordFighters: 0, axeFighters: 0, archers: 0, magicians: 0, horsemen: 0, catapults: 0 };
    for (const c of contribs) {
        total.spearFighters += c.troops.spearFighters || 0;
        total.swordFighters += c.troops.swordFighters || 0;
        total.axeFighters += c.troops.axeFighters || 0;
        total.archers += c.troops.archers || 0;
        total.magicians += c.troops.magicians || 0;
        total.horsemen += c.troops.horsemen || 0;
        total.catapults += c.troops.catapults || 0;
    }
    return total;
}

export function getTotalTroopCount(troops: { spearFighters: number; swordFighters: number; axeFighters: number; archers: number; magicians: number; horsemen: number; catapults: number }): number {
    return (troops.spearFighters || 0) + (troops.swordFighters || 0) + (troops.axeFighters || 0) +
        (troops.archers || 0) + (troops.magicians || 0) + (troops.horsemen || 0) + (troops.catapults || 0);
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

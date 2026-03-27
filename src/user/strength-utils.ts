import {
    spearFighterAttackingStat,
    swordFighterAttackingStat,
    axeFighterAttackingStat,
    archerAttackingStat,
    magicianAttackingStat,
    horsemenAttackingStat,
    catapultsAttackingStat,
} from 'utils';
import { DbAccessorService } from '../database/services/db-accessor.service';
import { User } from './models/user.entity';

const USERS_COLLECTION = 'users';
const MOVEMENTS_COLLECTION = 'movements';

const TROOP_MOVEMENT_TYPES = [
    'attack',
    'return',
    'boss_attack',
    'oasis_garrison',
    'oasis_attack',
    'oasis_return',
];

function troopsAttackPower(troops: any): number {
    if (!troops) return 0;
    return (
        (troops.spearFighters || 0) * spearFighterAttackingStat +
        (troops.swordFighters || 0) * swordFighterAttackingStat +
        (troops.axeFighters || 0) * axeFighterAttackingStat +
        (troops.archers || 0) * archerAttackingStat +
        (troops.magicians || 0) * magicianAttackingStat +
        (troops.horsemen || 0) * horsemenAttackingStat +
        (troops.catapults || 0) * catapultsAttackingStat
    );
}

/**
 * Compute total attack power for a player across ALL troop locations:
 * - Troops sitting in villages
 * - Troops sent to support clanmates (supportSent per village)
 * - Troops garrisoned in oases (oasisTroopsSent per village)
 * - Troops in transit (movements collection: attacks, returns, boss attacks, oasis movements)
 *
 * Support movements are NOT counted separately because supportSent already
 * includes troops as soon as the send is issued.
 */
export async function computePlayerTotalStrength(
    db: DbAccessorService,
    user: User,
): Promise<number> {
    let total = 0;

    for (const v of user.villages) {
        total += troopsAttackPower(v.troops);

        if (v.supportSent) {
            for (const entry of v.supportSent) {
                total += troopsAttackPower(entry.troops);
            }
        }

        if (v.oasisTroopsSent) {
            for (const entry of v.oasisTroopsSent) {
                total += troopsAttackPower(entry.troops);
            }
        }
    }

    const movements = await db
        .getCollection(MOVEMENTS_COLLECTION)
        .find({
            senderUsername: user.username,
            status: 'in_transit',
            type: { $in: TROOP_MOVEMENT_TYPES },
        })
        .project({ troops: 1 })
        .toArray();

    for (const m of movements) {
        total += troopsAttackPower(m.troops);
    }

    return total;
}

/**
 * Compute total attack power for a clan (sum of all members' total strength).
 */
export async function computeClanTotalStrength(
    db: DbAccessorService,
    memberUsernames: string[],
): Promise<number> {
    if (!memberUsernames.length) return 0;

    const members = await db
        .getCollection(USERS_COLLECTION)
        .find({ username: { $in: memberUsernames } })
        .project({ username: 1, villages: 1 })
        .toArray();

    let total = 0;

    for (const member of members) {
        for (const v of (member.villages || [])) {
            total += troopsAttackPower(v.troops);

            if (v.supportSent) {
                for (const entry of v.supportSent) {
                    total += troopsAttackPower(entry.troops);
                }
            }

            if (v.oasisTroopsSent) {
                for (const entry of v.oasisTroopsSent) {
                    total += troopsAttackPower(entry.troops);
                }
            }
        }
    }

    const movements = await db
        .getCollection(MOVEMENTS_COLLECTION)
        .find({
            senderUsername: { $in: memberUsernames },
            status: 'in_transit',
            type: { $in: TROOP_MOVEMENT_TYPES },
        })
        .project({ troops: 1 })
        .toArray();

    for (const m of movements) {
        total += troopsAttackPower(m.troops);
    }

    return total;
}

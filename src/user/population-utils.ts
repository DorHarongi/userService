import { quartersPopulationByLevel } from 'utils';
import { DbAccessorService } from '../database/services/db-accessor.service';
import { User } from './models/user.entity';
import { Village } from './models/village.entity';
import { OasisTroopsSentEntry } from './models/supportSent';
import { TroopsAmounts } from './models/troopsAmounts';

const USERS_COLLECTION = 'users';
const MOVEMENTS_COLLECTION = 'movements';
const OASES_COLLECTION = 'oases';

const TRANSIT_MOVEMENT_TYPES = [
    'attack',
    'return',
    'boss_attack',
    'oasis_garrison',
    'oasis_attack',
    'oasis_return',
];

function sumTroops(troops: any): number {
    if (!troops) return 0;
    return (
        (troops.spearFighters || 0) +
        (troops.swordFighters || 0) +
        (troops.axeFighters || 0) +
        (troops.archers || 0) +
        (troops.magicians || 0) +
        (troops.horsemen || 0) +
        (troops.catapults || 0)
    );
}

/**
 * Count troops that belong to a village but are currently in transit
 * (queried from the movements collection — ground truth).
 */
export async function countTroopsInTransit(
    db: DbAccessorService,
    username: string,
    villageName: string,
): Promise<number> {
    const movements = await db
        .getCollection(MOVEMENTS_COLLECTION)
        .find({
            senderUsername: username,
            senderVillageName: villageName,
            status: 'in_transit',
            type: { $in: TRANSIT_MOVEMENT_TYPES },
        })
        .toArray();

    let total = 0;
    for (const m of movements) {
        total += sumTroops(m.troops);
    }
    return total;
}

/**
 * Build the ground-truth oasisTroopsSent entries for a village
 * by querying the oases collection directly.
 */
export async function getOasisTroopsEntries(
    db: DbAccessorService,
    username: string,
    villageName: string,
): Promise<OasisTroopsSentEntry[]> {
    const oases = await db
        .getCollection(OASES_COLLECTION)
        .find({ 'garrison.username': username })
        .project({ _id: 1, 'garrison.contributions': 1 })
        .toArray();

    const entries: OasisTroopsSentEntry[] = [];
    for (const oasis of oases) {
        const contribs = oasis.garrison?.contributions;
        if (!Array.isArray(contribs)) continue;
        for (const contrib of contribs) {
            if (contrib.villageName === villageName) {
                entries.push({
                    oasisId: oasis._id.toHexString(),
                    troops: new TroopsAmounts(
                        contrib.troops.spearFighters || 0,
                        contrib.troops.swordFighters || 0,
                        contrib.troops.axeFighters || 0,
                        contrib.troops.archers || 0,
                        contrib.troops.magicians || 0,
                        contrib.troops.horsemen || 0,
                        contrib.troops.catapults || 0,
                    ),
                });
            }
        }
    }
    return entries;
}

/**
 * Compute the authoritative free population for a village by combining
 * the village document with ground-truth data from movements and oases.
 * Pure read — does not write anything.  Use reconcileAllVillages
 * to persist corrected counters before building a response DTO.
 */
export async function getAccurateFreePopulation(
    db: DbAccessorService,
    village: Village,
    username: string,
): Promise<number> {
    const max =
        quartersPopulationByLevel[village.buildingsLevels.quartersLevel];
    const inVillageTroops = Village.getTotalTroops(village);
    const inVillageWorkers = Village.getTotalWorkers(village);
    const supportSent = Village.getTotalSupportSent(village);

    const realTransit = await countTroopsInTransit(
        db, username, village.villageName,
    );
    const realOasisEntries = await getOasisTroopsEntries(
        db, username, village.villageName,
    );
    let realOasisTroops = 0;
    for (const entry of realOasisEntries) {
        realOasisTroops += sumTroops(entry.troops);
    }

    return max - inVillageTroops - inVillageWorkers - supportSent - realTransit - realOasisTroops;
}

/**
 * Reconcile troopsInTransit and oasisTroopsSent on every village
 * of a user so the document matches ground truth.
 * Call before building a UserDTO for login / getUser / any response.
 */
export async function reconcileAllVillages(
    db: DbAccessorService,
    user: User,
): Promise<void> {
    const setFields: Record<string, any> = {};

    for (let i = 0; i < user.villages.length; i++) {
        const v = user.villages[i];
        const vp = `villages.${i}`;

        const realTransit = await countTroopsInTransit(
            db, user.username, v.villageName,
        );
        const realOasisEntries = await getOasisTroopsEntries(
            db, user.username, v.villageName,
        );

        setFields[`${vp}.troopsInTransit`] = realTransit;
        setFields[`${vp}.oasisTroopsSent`] = realOasisEntries;

        user.villages[i].troopsInTransit = realTransit;
        user.villages[i].oasisTroopsSent = realOasisEntries;
    }

    if (Object.keys(setFields).length > 0) {
        await db.getCollection(USERS_COLLECTION).updateOne(
            { username: user.username },
            { $set: setFields },
        );
    }
}

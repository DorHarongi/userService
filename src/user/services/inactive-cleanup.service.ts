import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DbAccessorService } from '../../database/services/db-accessor.service';
import { ServerContextService } from '../../database/services/server-context.service';
import { ClansService } from '../../clans/services/clans.service';
import { RelicsService, RelicDocument } from '../../relics/relics.service';
import { User } from '../models/user.entity';
import { calculateDistance, RELIC_NAMES } from 'utils';

const USERS_COLLECTION = 'users';
const CLANS_COLLECTION = 'clans';
const OASES_COLLECTION = 'oases';
const MOVEMENTS_COLLECTION = 'movements';
const INACTIVITY_DAYS = 10;
const RELIC_SPEED = 1; // tiles per minute

const OFFENSIVE_MOVEMENT_TYPES = [
    'attack', 'boss_attack', 'oasis_attack', 'oasis_garrison', 'support', 'resources',
];

@Injectable()
export class InactiveCleanupService {
    private readonly logger = new Logger(InactiveCleanupService.name);

    constructor(
        private dbAccessorService: DbAccessorService,
        private serverContextService: ServerContextService,
        private clansService: ClansService,
        private relicsService: RelicsService,
    ) {}

    @Cron('0 0 * * *') // midnight UTC daily
    async cleanupInactivePlayers(): Promise<void> {
        await this.serverContextService.forEachServer(async (serverId) => {
            try {
                await this.runCleanup(serverId);
            } catch (e) {
                this.logger.error(`Inactive cleanup failed for server ${serverId}: ${e.message}`);
            }
        });
    }

    private async runCleanup(serverId: number): Promise<void> {
        const cutoff = new Date(Date.now() - INACTIVITY_DAYS * 24 * 60 * 60 * 1000);

        const inactiveUsers = await this.dbAccessorService
            .getCollection(USERS_COLLECTION)
            .find({
                isDeleted: { $ne: true },
                $or: [
                    { lastLoginDate: { $exists: false } },
                    { lastLoginDate: null },
                    { lastLoginDate: { $lt: cutoff } },
                ],
            })
            .toArray() as User[];

        if (inactiveUsers.length === 0) return;

        this.logger.log(`Server ${serverId}: found ${inactiveUsers.length} inactive player(s) to soft-delete`);

        for (const user of inactiveUsers) {
            try {
                await this.softDeleteUser(user);
                this.logger.log(`Soft-deleted: ${user.username}`);
            } catch (e) {
                this.logger.error(`Failed to soft-delete ${user.username}: ${e.message}`);
            }
        }
    }

    private async softDeleteUser(user: User): Promise<void> {
        // 1) Handle relics BEFORE clan kick (need clan info)
        await this.handleRelics(user);

        // 2) Clan kick (withdraws/returns support troops via movements)
        if (user.clanName && user.clanName !== '') {
            await this.removeFromClan(user);
        }

        // 3) Cancel pending clan join requests
        if (user.pendingClanRequests?.length > 0) {
            await this.cancelPendingRequests(user);
        }

        // 4) Clear oasis garrisons (create return movements)
        await this.clearOasisGarrisons(user);

        // 5) Cancel outgoing offensive movements
        await this.dbAccessorService.getCollection(MOVEMENTS_COLLECTION).deleteMany({
            senderUsername: user.username,
            status: 'in_transit',
            type: { $in: OFFENSIVE_MOVEMENT_TYPES },
        });

        // 6) Set isDeleted
        await this.dbAccessorService.getCollection(USERS_COLLECTION).updateOne(
            { username: user.username },
            { $set: { isDeleted: true } },
        );
    }

    private async handleRelics(user: User): Promise<void> {
        const heldRelicIds = await this.relicsService.getRelicIdsHeldByUser(user.username);
        if (heldRelicIds.length === 0) return;

        for (const relicId of heldRelicIds) {
            const allRelics = await this.relicsService.getAllRelics();
            const relic = allRelics.find(r => r.relicId === relicId);
            if (!relic) continue;

            const targetClanName = user.clanName && user.clanName !== ''
                ? user.clanName
                : (relic.originClanName || relic.holderClanName || null);

            const leader = await this.findClanLeader(targetClanName);
            if (!leader) {
                const anyLeader = await this.findAnyActiveClanLeader();
                if (anyLeader) {
                    await this.transferRelicToPlayer(relic, user, anyLeader.username, anyLeader.villageName, anyLeader.clanName);
                }
                continue;
            }

            await this.transferRelicToPlayer(relic, user, leader.username, leader.villageName, leader.clanName);
        }
    }

    private async transferRelicToPlayer(
        relic: RelicDocument,
        fromUser: User,
        targetUsername: string,
        targetVillageName: string,
        targetClanName: string,
    ): Promise<void> {
        const sourceVillage = fromUser.villages.find(
            v => v.villageName === relic.holderVillageName,
        ) || fromUser.villages[0];

        const targetUser = await this.dbAccessorService.getCollection(USERS_COLLECTION)
            .findOne({ username: targetUsername }) as any;
        const targetVillage = targetUser?.villages?.find(
            (v: any) => v.villageName === targetVillageName,
        ) || targetUser?.villages?.[0];

        let travelTimeMs = 0;
        if (sourceVillage?.location && targetVillage?.location) {
            const dist = calculateDistance(
                sourceVillage.location.x, sourceVillage.location.y,
                targetVillage.location.x, targetVillage.location.y,
            );
            travelTimeMs = Math.round((dist / RELIC_SPEED) * 60 * 1000);
        }

        await this.relicsService['collection'].updateOne(
            { relicId: relic.relicId },
            {
                $set: {
                    holderUsername: null,
                    holderVillageName: null,
                    holderClanName: targetClanName,
                },
            },
        );

        const now = new Date();
        await this.dbAccessorService.getCollection(MOVEMENTS_COLLECTION).insertOne({
            type: 'relic_transfer',
            senderUsername: fromUser.username,
            senderVillageName: sourceVillage?.villageName || '',
            targetUsername,
            targetVillageName: targetVillage?.villageName || targetVillageName,
            departureTime: now,
            arrivalTime: new Date(now.getTime() + travelTimeMs),
            status: 'in_transit',
            relicId: relic.relicId,
        });

        const relicName = RELIC_NAMES.find(r => r.id === relic.relicId)?.name ?? relic.relicId;
        this.logger.log(`Relic ${relicName} transferred from inactive ${fromUser.username} to ${targetUsername}`);
    }

    private async findClanLeader(clanName: string | null): Promise<{
        username: string; villageName: string; clanName: string;
    } | null> {
        if (!clanName) return null;
        const clan = await this.dbAccessorService.getCollection(CLANS_COLLECTION)
            .findOne({ clanName }) as any;
        if (!clan?.leaderUsername) return null;

        const leader = await this.dbAccessorService.getCollection(USERS_COLLECTION)
            .findOne({ username: clan.leaderUsername, isDeleted: { $ne: true } }) as User;
        if (!leader?.villages?.length) return null;

        return {
            username: leader.username,
            villageName: leader.villages[0].villageName,
            clanName,
        };
    }

    private async findAnyActiveClanLeader(): Promise<{
        username: string; villageName: string; clanName: string;
    } | null> {
        const clans = await this.dbAccessorService.getCollection(CLANS_COLLECTION)
            .find({}).sort({ 'members.length': -1 }).limit(10).toArray() as any[];

        for (const clan of clans) {
            if (!clan.leaderUsername) continue;
            const leader = await this.dbAccessorService.getCollection(USERS_COLLECTION)
                .findOne({ username: clan.leaderUsername, isDeleted: { $ne: true } }) as User;
            if (leader?.villages?.length) {
                return {
                    username: leader.username,
                    villageName: leader.villages[0].villageName,
                    clanName: clan.clanName,
                };
            }
        }
        return null;
    }

    private async removeFromClan(user: User): Promise<void> {
        await this.clansService.withdrawAllSupportTroops(user.username);
        await this.clansService.returnReceivedSupportTroops(user.username);

        await this.dbAccessorService.getCollection(CLANS_COLLECTION)
            .updateOne({ clanName: user.clanName }, { $pull: { members: user.username } } as any);

        await this.dbAccessorService.getCollection(USERS_COLLECTION)
            .updateOne({ username: user.username }, { $set: { clanName: '' } });

        await this.relicsService.updateHolderClanForUser(user.username, null);
    }

    private async cancelPendingRequests(user: User): Promise<void> {
        for (const clanName of user.pendingClanRequests) {
            await this.dbAccessorService.getCollection(CLANS_COLLECTION).updateOne(
                { clanName },
                { $pull: { pendingRequests: { username: user.username } } } as any,
            );
        }

        await this.dbAccessorService.getCollection(USERS_COLLECTION).updateOne(
            { username: user.username },
            { $set: { pendingClanRequests: [] } },
        );
    }

    private async clearOasisGarrisons(user: User): Promise<void> {
        const oases = await this.dbAccessorService.getCollection(OASES_COLLECTION)
            .find({ 'garrison.username': user.username }).toArray() as any[];

        for (const oasis of oases) {
            if (!oasis.garrison) continue;

            const contributions: any[] = oasis.garrison.contributions || [oasis.garrison];
            const movementsToInsert: any[] = [];

            for (const contrib of contributions) {
                if (!contrib.villageName) continue;
                const village = user.villages.find(v => v.villageName === contrib.villageName);
                if (!village?.location) continue;

                const distance = calculateDistance(
                    village.location.x, village.location.y, oasis.x, oasis.y,
                );
                const travelTimeMs = Math.max(1000, Math.round((distance / 3) * 60 * 1000));
                const now = new Date();

                movementsToInsert.push({
                    type: 'oasis_return',
                    senderUsername: user.username,
                    senderVillageName: contrib.villageName,
                    targetUsername: user.username,
                    targetVillageName: contrib.villageName,
                    troops: contrib.troops || {},
                    resources: contrib.stash || { wood: 0, stone: 0, crop: 0 },
                    departureTime: now,
                    arrivalTime: new Date(now.getTime() + travelTimeMs),
                    status: 'in_transit',
                    oasisId: oasis._id.toHexString(),
                });
            }

            if (movementsToInsert.length > 0) {
                await this.dbAccessorService.getCollection(MOVEMENTS_COLLECTION)
                    .insertMany(movementsToInsert);
            }

            // Also remove oasisTroopsSent tracking from user villages
            for (const village of user.villages) {
                if (village.oasisTroopsSent) {
                    village.oasisTroopsSent = village.oasisTroopsSent.filter(
                        (o: any) => o.oasisId !== oasis._id.toHexString(),
                    );
                }
            }

            await this.dbAccessorService.getCollection(OASES_COLLECTION).updateOne(
                { _id: oasis._id },
                { $unset: { garrison: '' } },
            );
        }

        // Save updated oasisTroopsSent on user
        if (oases.length > 0) {
            await this.dbAccessorService.getCollection(USERS_COLLECTION).updateOne(
                { username: user.username },
                { $set: { villages: user.villages } },
            );
        }
    }
}

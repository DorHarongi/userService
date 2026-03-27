import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { RELIC_NAMES, RELIC_TRANSFER_COOLDOWN_MS, calculateDistance } from 'utils';
import { AnnouncementsService } from '../announcements/announcements.service';
import { DbAccessorService } from '../database/services/db-accessor.service';
import { ServerService } from '../server/server.service';

const RELIC_SPEED = 1; // 1 tile per minute
const MOVEMENTS_COLLECTION = 'movements';

const RELICS_COLLECTION = 'relics';
const USERS_COLLECTION = 'users';
const CLANS_COLLECTION = 'clans';

export interface RelicDocument {
  relicId: string;
  holderUsername: string | null;
  holderVillageName: string | null;
  holderClanName: string | null;
  transferCooldownUntil: Date | null;
  obtainedAt: Date | null;
  originClanName?: string | null;
}

@Injectable()
export class RelicsService {
  constructor(
    private dbAccessorService: DbAccessorService,
    private announcementsService: AnnouncementsService,
    private serverService: ServerService,
  ) {}

  async ensureInitialized(): Promise<void> {
    const count = await this.dbAccessorService
      .getCollection(RELICS_COLLECTION)
      .countDocuments();
    if (count === 0) {
      const docs = RELIC_NAMES.map((r) => ({
        relicId: r.id,
        holderUsername: null,
        holderVillageName: null,
        holderClanName: null,
        transferCooldownUntil: null,
        obtainedAt: null,
      }));
      await this.dbAccessorService
        .getCollection(RELICS_COLLECTION)
        .insertMany(docs);
      return;
    }
  }

  private get collection() {
    return this.dbAccessorService.getCollection(RELICS_COLLECTION);
  }

  async getAllRelics(): Promise<RelicDocument[]> {
    await this.ensureInitialized();
    return this.collection.find({}).toArray() as unknown as Promise<
      RelicDocument[]
    >;
  }

  async getRelicsByClan(clanName: string): Promise<RelicDocument[]> {
    const all = await this.getAllRelics();
    return all.filter((r) => r.holderClanName === clanName);
  }

  async transferRelic(
    leaderUsername: string,
    relicId: string,
    targetUsername: string,
    targetVillageName: string,
  ): Promise<{ success: boolean }> {
    const clan = (await this.dbAccessorService
      .getCollection(CLANS_COLLECTION)
      .findOne({ leaderUsername })) as any;
    if (!clan || clan.clanName == null) {
      throw new HttpException(
        'Only clan leader can transfer relics',
        HttpStatus.FORBIDDEN,
      );
    }

    const relic = (await this.collection.findOne({
      relicId,
    })) as unknown as RelicDocument;
    if (!relic)
      throw new HttpException('Relic not found', HttpStatus.NOT_FOUND);
    if (relic.holderClanName !== clan.clanName) {
      throw new HttpException(
        'Your clan does not hold this relic',
        HttpStatus.FORBIDDEN,
      );
    }
    if (
      relic.transferCooldownUntil &&
      new Date() < new Date(relic.transferCooldownUntil)
    ) {
      throw new HttpException(
        'Relic is on transfer cooldown',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!relic.holderUsername) {
      throw new HttpException(
        'Relic is currently in transit',
        HttpStatus.BAD_REQUEST,
      );
    }

    const currentHolder = (await this.dbAccessorService
      .getCollection(USERS_COLLECTION)
      .findOne({ username: relic.holderUsername })) as any;

    const targetUser = (await this.dbAccessorService
      .getCollection(USERS_COLLECTION)
      .findOne({ username: targetUsername })) as any;
    if (!targetUser)
      throw new HttpException('Target user not found', HttpStatus.NOT_FOUND);
    if (targetUser.clanName !== clan.clanName) {
      throw new HttpException(
        'Target must be in your clan',
        HttpStatus.BAD_REQUEST,
      );
    }
    const targetVillage = targetUser.villages?.find(
      (v: any) => v.villageName === targetVillageName,
    );
    if (!targetVillage)
      throw new HttpException('Target village not found', HttpStatus.NOT_FOUND);

    const sourceVillage = currentHolder?.villages?.find(
      (v: any) => v.villageName === relic.holderVillageName,
    );

    let travelTimeMs = 0;
    if (sourceVillage && targetVillage.location) {
      const distance = calculateDistance(
        sourceVillage.location.x,
        sourceVillage.location.y,
        targetVillage.location.x,
        targetVillage.location.y,
      );
      travelTimeMs = Math.round((distance / RELIC_SPEED) * 60 * 1000);
    }

    // Clear current holder while relic is in transit
    await this.collection.updateOne(
      { relicId },
      {
        $set: {
          holderUsername: null,
          holderVillageName: null,
        },
      },
    );

    const departureTime = new Date();
    const arrivalTime = new Date(departureTime.getTime() + travelTimeMs);

    await this.dbAccessorService.getCollection(MOVEMENTS_COLLECTION).insertOne({
      type: 'relic_transfer',
      senderUsername: relic.holderUsername || leaderUsername,
      senderVillageName: relic.holderVillageName || '',
      targetUsername,
      targetVillageName,
      departureTime,
      arrivalTime,
      status: 'in_transit',
      relicId,
    });

    return { success: true };
  }

  /** Assign relic to a holder. Returns relic name for announcement. */
  async assignRelicToClan(
    relicId: string,
    clanName: string | null,
    username: string,
    villageName: string,
  ): Promise<string> {
    await this.ensureInitialized();
    const relicDef = RELIC_NAMES.find((r) => r.id === relicId);
    const name = relicDef?.name ?? relicId;

    const existing = await this.collection.findOne({ relicId }) as unknown as RelicDocument | null;
    const setFields: any = {
      holderUsername: username,
      holderVillageName: villageName,
      holderClanName: clanName,
      transferCooldownUntil: null,
      obtainedAt: new Date(),
    };
    if (!existing?.originClanName && clanName) {
      setFields.originClanName = clanName;
    }

    await this.collection.updateOne(
      { relicId },
      { $set: setFields },
    );
    await this.serverService.checkWinCondition();
    return name;
  }

  /** Get all relic IDs held by a user (any village). */
  async getRelicIdsHeldByUser(username: string): Promise<string[]> {
    const all = await this.getAllRelics();
    return all
      .filter((r) => r.holderUsername === username)
      .map((r) => r.relicId);
  }

  /** Get relic IDs held by a specific village (username + villageName). */
  async getRelicIdsHeldByVillage(
    username: string,
    villageName: string,
  ): Promise<string[]> {
    const all = await this.getAllRelics();
    return all
      .filter(
        (r) =>
          r.holderUsername === username && r.holderVillageName === villageName,
      )
      .map((r) => r.relicId);
  }

  /** Steal all relics from defender village to attacker (after total wipe). Returns list of stolen relic names. */
  async stealRelicsFromVillage(
    defenderUsername: string,
    defenderVillageName: string,
    attackerUsername: string,
    attackerVillageName: string,
    attackerClanName: string,
  ): Promise<string[]> {
    const held = await this.getRelicIdsHeldByVillage(
      defenderUsername,
      defenderVillageName,
    );
    if (held.length === 0) return [];

    const names: string[] = [];
    for (const relicId of held) {
      const relicDef = RELIC_NAMES.find((r) => r.id === relicId);
      names.push(relicDef?.name ?? relicId);
      await this.collection.updateOne(
        { relicId },
        {
          $set: {
            holderUsername: attackerUsername,
            holderVillageName: attackerVillageName,
            holderClanName: attackerClanName ?? null,
            transferCooldownUntil: null,
            obtainedAt: new Date(),
          },
        },
      );
    }

    await this.serverService.checkWinCondition();
    return names;
  }

  /** Proxy for win condition check, callable from MovementService. */
  async checkWinAfterChange(): Promise<void> {
    await this.serverService.checkWinCondition();
  }

  /**
   * When a player leaves/joins clan: update holderClanName only.
   * IMPORTANT: Never modify transferCooldownUntil here. Cooldown is only set on actual transfer
   * (transferRelic). Steal/mythic set null. Leave+rejoin must NOT reset cooldown (anti-exploit).
   */
  async updateHolderClanForUser(
    username: string,
    newClanName: string | null,
  ): Promise<void> {
    await this.collection.updateMany(
      { holderUsername: username },
      { $set: { holderClanName: newClanName } },
    );
    if (newClanName) {
      await this.serverService.checkWinCondition();
    }
  }
}

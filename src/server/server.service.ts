import { Injectable } from '@nestjs/common';
import { DbAccessorService } from '../database/services/db-accessor.service';
import { RELIC_NAMES } from 'utils';
import { AnnouncementsService } from '../announcements/announcements.service';

const SERVER_CONFIG_COLLECTION = 'serverConfig';
const RELICS_COLLECTION = 'relics';

export interface ServerConfigDocument {
  serverId: number;
  status: 'active' | 'ended';
  winningClanName?: string;
  endedAt?: Date;
}

@Injectable()
export class ServerService {
  constructor(
    private dbAccessorService: DbAccessorService,
    private announcementsService: AnnouncementsService,
  ) {}

  private get configCollection() {
    return this.dbAccessorService.getCollection(SERVER_CONFIG_COLLECTION);
  }

  async getServerStatus(): Promise<ServerConfigDocument> {
    const doc = await this.configCollection.findOne({}) as unknown as ServerConfigDocument | null;
    if (doc) return doc;
    return { serverId: 1, status: 'active' };
  }

  async endServer(winningClanName: string): Promise<void> {
    await this.configCollection.updateOne(
      {},
      { $set: { status: 'ended', winningClanName, endedAt: new Date() } },
      { upsert: true },
    );
    await this.announcementsService.createAnnouncement(
      'server_ended',
      `🏆 Clan **${winningClanName}** has collected all 5 Divine Relics and won the game!`,
      { winningClanName },
    );
  }

  /** Called after any relic change. If one clan holds all 5, end the server. */
  async checkWinCondition(): Promise<void> {
    const config = await this.getServerStatus();
    if (config.status === 'ended') return;

    const relics = await this.dbAccessorService.getCollection(RELICS_COLLECTION).find({}).toArray() as any[];
    const relicIds = RELIC_NAMES.map((r) => r.id);
    const heldByClan: Record<string, number> = {};
    for (const r of relics) {
      if (r.holderClanName && relicIds.includes(r.relicId)) {
        heldByClan[r.holderClanName] = (heldByClan[r.holderClanName] ?? 0) + 1;
      }
    }
    const winner = Object.entries(heldByClan).find(([, count]) => count === 5);
    if (winner) {
      await this.endServer(winner[0]);
    }
  }
}

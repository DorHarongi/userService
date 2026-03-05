import { Injectable } from '@nestjs/common';
import { DbAccessorService } from '../database/services/db-accessor.service';
import { DbConnectorService } from '../database/services/db-connector.service';
import { RELIC_NAMES } from 'utils';
import { AnnouncementsService } from '../announcements/announcements.service';

const SERVER_CONFIG_COLLECTION = 'serverConfig';
const RELICS_COLLECTION = 'relics';
const SERVERS_COLLECTION = 'servers';

export interface ServerConfigDocument {
  serverId: number;
  status: 'active' | 'ended';
  winningClanName?: string;
  endedAt?: Date;
}

export interface ServerListItem {
  serverId: number;
  name: string;
  status: string;
  playerCount?: number;
  isClosed?: boolean;
}

@Injectable()
export class ServerService {
  constructor(
    private dbAccessorService: DbAccessorService,
    private dbConnectorService: DbConnectorService,
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

  private readonly USERS_COLLECTION = 'users';

  /** List all servers (from accounts DB). Returns [] if accounts DB or servers collection not yet created. */
  async getServersList(): Promise<ServerListItem[]> {
    try {
      const coll = this.dbConnectorService.getAccountsDb().collection(SERVERS_COLLECTION);
      const docs = await coll.find({}).sort({ serverId: 1 }).toArray() as any[];
      const list: ServerListItem[] = [];
      for (const d of docs) {
        const serverId = d.serverId as number;
        let playerCount = 0;
        try {
          const serverDb = this.dbConnectorService.getServerDb(serverId);
          playerCount = await serverDb.collection(this.USERS_COLLECTION).countDocuments();
        } catch {
          // ignore missing DB
        }
        list.push({
          serverId,
          name: d.name ?? `Server ${serverId}`,
          status: d.status ?? 'active',
          playerCount,
          isClosed: d.isClosed ?? false,
        });
      }
      return list;
    } catch {
      return [];
    }
  }

  /** Check if registration should be closed for a given server. */
  async isRegistrationClosed(serverId: number): Promise<boolean> {
    try {
      const coll = this.dbConnectorService.getAccountsDb().collection(SERVERS_COLLECTION);
      const doc = await coll.findOne({ serverId }) as any;
      if (!doc) {
        // If server not defined yet, allow registration by default
        return false;
      }
      if (doc.status === 'ended') {
        return true;
      }
      return !!doc.isClosed;
    } catch {
      return false;
    }
  }

  /** Record that a player has selected this server (optional: increment playerCount). */
  async joinServer(username: string, serverId: number): Promise<{ success: boolean }> {
    const coll = this.dbConnectorService.getAccountsDb().collection(SERVERS_COLLECTION);
    const server = await coll.findOne({ serverId }) as any;
    if (!server) {
      return { success: false };
    }
    // For now we do not mutate playerCount here to avoid inaccurate counts.
    return { success: true };
  }

  /** Create a new server (e.g. after a server wins). */
  async createServer(name?: string): Promise<ServerListItem> {
    const coll = this.dbConnectorService.getAccountsDb().collection(SERVERS_COLLECTION);
    const max = await coll.find({}).sort({ serverId: -1 }).limit(1).toArray() as any[];
    const nextId = (max[0]?.serverId ?? 0) + 1;
    const doc = {
      serverId: nextId,
      name: name ?? `Server ${nextId}`,
      status: 'active',
      playerCount: 0,
    };
    await coll.insertOne(doc);
    return doc;
  }
}

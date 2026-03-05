import { Injectable } from '@nestjs/common';
import * as mongo from 'mongodb';

const SERVER_DB_PREFIX = 'pasiflora_server_';
const ACCOUNTS_DB_NAME = 'pasiflora_accounts';

@Injectable()
export class DbConnectorService {
  private client: mongo.MongoClient | null = null;
  private serverDbCache = new Map<number, mongo.Db>();
  private accountsDb: mongo.Db | null = null;

  async connect(): Promise<mongo.Db> {
    if (this.client) {
      return this.getServerDb(1);
    }
    this.client = await mongo.MongoClient.connect('mongodb://localhost:27017', {
      maxPoolSize: 50,
      minPoolSize: 5,
    });
    if (!this.client) {
      console.log('Mongo down. trying again...');
      return this.connect();
    }
    console.log('Connected to MongoDB successfully');
    const serverIds = await this.getActiveServerIds();
    for (const id of serverIds) {
      await this.ensureIndexesForDb(this.getServerDb(id));
    }
    return this.getServerDb(1);
  }

  getServerDb(serverId: number): mongo.Db {
    if (!this.client) {
      throw new Error('DbConnectorService not connected. Call connect() first.');
    }
    let db = this.serverDbCache.get(serverId);
    if (!db) {
      const dbName = `${SERVER_DB_PREFIX}${serverId}`;
      db = this.client.db(dbName);
      this.serverDbCache.set(serverId, db);
    }
    return db;
  }

  getAccountsDb(): mongo.Db {
    if (!this.client) {
      throw new Error('DbConnectorService not connected. Call connect() first.');
    }
    if (!this.accountsDb) {
      this.accountsDb = this.client.db(ACCOUNTS_DB_NAME);
    }
    return this.accountsDb;
  }

  private async getActiveServerIds(): Promise<number[]> {
    try {
      const accts = this.getAccountsDb();
      const servers = await accts.collection('servers').find({}).toArray();
      if (servers.length > 0) {
        return servers.map((s: any) => s.serverId as number).filter(Boolean);
      }
    } catch { /* fall through */ }
    return [1];
  }

  private async ensureIndexesForDb(db: mongo.Db): Promise<void> {
    const createIndexSafe = async (
      collectionName: string,
      indexSpec: mongo.IndexSpecification,
      options?: mongo.CreateIndexesOptions,
    ) => {
      try {
        await db.collection(collectionName).createIndex(indexSpec, options);
      } catch (error: any) {
        if (error.code === 85 || error.code === 86 || error.codeName === 'IndexOptionsConflict' || error.message?.includes('already exists')) {
          // skip
        } else {
          console.warn(`Warning: Could not create index on ${collectionName}:`, error.message || error);
        }
      }
    };

    await createIndexSafe('users', { username: 1 }, { unique: true });
    await createIndexSafe('users', { clanName: 1 });
    await createIndexSafe('users', { joinDate: 1 });
    await createIndexSafe('bosses', { isDefeated: 1, x: 1, y: 1 });
    await createIndexSafe('bosses', { claimedByClanId: 1 });
    await createIndexSafe('clans', { name: 1 }, { unique: true });
  }
}

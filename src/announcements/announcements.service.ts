import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DbAccessorService } from '../database/services/db-accessor.service';
import { ServerContextService } from '../database/services/server-context.service';

const ANNOUNCEMENTS_COLLECTION = 'announcements';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface AnnouncementDocument {
  type: string;
  content: string;
  metadata?: Record<string, any>;
  date: Date;
}

@Injectable()
export class AnnouncementsService {
  constructor(
    private dbAccessorService: DbAccessorService,
    private serverContextService: ServerContextService,
  ) {}

  private get collection() {
    return this.dbAccessorService.getCollection(ANNOUNCEMENTS_COLLECTION);
  }

  async createAnnouncement(type: string, content: string, metadata?: Record<string, any>): Promise<void> {
    await this.collection.insertOne({
      type,
      content,
      metadata: metadata ?? {},
      date: new Date(),
    });
  }

  async getRecent(limit: number = 20): Promise<AnnouncementDocument[]> {
    return this.collection
      .find({})
      .sort({ date: -1 })
      .limit(limit)
      .toArray() as unknown as Promise<AnnouncementDocument[]>;
  }

  @Cron('0 0 * * * *') // every hour
  async cleanOldMessages(): Promise<void> {
    await this.serverContextService.forEachServer(async () => {
      const cutoff = new Date(Date.now() - MAX_AGE_MS);
      await this.collection.deleteMany({ date: { $lt: cutoff } });
    });
  }
}

import { Injectable } from '@nestjs/common';
import * as mongo from 'mongodb';

@Injectable()
export class DbConnectorService{
    connection: mongo.Db;
    async connect(): Promise<mongo.Db>
    {
        let mongoClient: mongo.MongoClient = await mongo.MongoClient.connect('mongodb://localhost:27017', {
            maxPoolSize: 50,
            minPoolSize: 5
        });
        if(mongoClient == undefined)
        {
            console.log("Mongo down. trying again...")
            await this.connect();
        }
        else
        {
            console.log("Connected to db succesfully");
            this.connection = mongoClient.db('users');
            await this.ensureIndexes();
            return this.connection;
        }
    }

    private async ensureIndexes(): Promise<void> {
        console.log("Ensuring database indexes...");
        
        // Users collection indexes
        await this.createIndexSafe('users', { username: 1 }, { unique: true });
        await this.createIndexSafe('users', { clanName: 1 });
        await this.createIndexSafe('users', { joinDate: 1 });
        
        // Bosses collection indexes
        await this.createIndexSafe('bosses', { isDefeated: 1, x: 1, y: 1 });
        await this.createIndexSafe('bosses', { claimedByClanId: 1 });
        
        // Clans collection indexes
        await this.createIndexSafe('clans', { name: 1 }, { unique: true });
        
        console.log("Database indexes check complete");
    }

    private async createIndexSafe(
        collectionName: string, 
        indexSpec: mongo.IndexSpecification, 
        options?: mongo.CreateIndexesOptions
    ): Promise<void> {
        try {
            await this.connection.collection(collectionName).createIndex(indexSpec, options);
        } catch (error: any) {
            // Index already exists with same spec - that's fine
            if (error.code === 85 || error.code === 86) {
                // 85: IndexOptionsConflict, 86: IndexKeySpecsConflict
                console.log(`Index on ${collectionName} already exists (different options), skipping`);
            } else if (error.codeName === 'IndexOptionsConflict' || error.message?.includes('already exists')) {
                console.log(`Index on ${collectionName} already exists, skipping`);
            } else {
                // Log but don't crash - indexes are optimization, not critical
                console.warn(`Warning: Could not create index on ${collectionName}:`, error.message || error);
            }
        }
    }
}


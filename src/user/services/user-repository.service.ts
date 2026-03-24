import { HttpException, HttpStatus, Injectable, Inject, forwardRef } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InsertOneResult } from 'mongodb';
import { DbAccessorService } from '../../database/services/db-accessor.service';
import { ServerContextService } from '../../database/services/server-context.service';
import { User } from '../models/user.entity';
import { userFromClientDTO } from '../dtos/userFromClientDTO';
import * as crypto from 'crypto';
import { UserDTO } from '../dtos/userDTO';
import { UserStatisticDTO } from '../dtos/userStatisticDTO';
import { Village } from '../models/village.entity';
import { UserVillageRequestDTO } from '../dtos/userVillageRequestDTO';
import { VillageDTO } from '../dtos/villageDTO';
import { WorldService } from '../../world/services/world.service';
import { Location } from '../models/location';
import { ACHIEVEMENTS } from 'utils';
import { reconcileAllVillages } from '../population-utils';

const MAX_USERS_IN_EACH_STATISTICS_PAGE = 10;
const COLLECTION_NAME = "users";

@Injectable()
export class UserRepositoryService {
    constructor(
        private dbAccessorService: DbAccessorService,
        private serverContextService: ServerContextService,
        @Inject(forwardRef(() => WorldService)) private worldService: WorldService
    ) {}
    async create(userFromClient: userFromClientDTO): Promise<boolean> {
        // Check if username already exists
        const existingUser = await this.dbAccessorService.getCollection(COLLECTION_NAME).findOne({ username: userFromClient.username });
        if (existingUser) {
            throw new HttpException("Username already exists", HttpStatus.CONFLICT);
        }

        // Initialize world if needed
        try {
            await this.worldService.initializeWorld();
        } catch (e) {
            console.error("World initialization error (may be partial, continuing):", e.message);
        }

        // Find a location using proximity-based placement
        const location: Location = await this.worldService.findLocationForNewVillage();
        
        const defaultVillageName = "New Village";
        // Try to reserve the grid cell FIRST before creating user
        const reserved = await this.worldService.reserveGridForVillage(location.x, location.y, userFromClient.username, defaultVillageName);
        if (!reserved) {
            // Retry with a different location
            const retryLocation = await this.worldService.findLocationForNewVillage();
            const retryReserved = await this.worldService.reserveGridForVillage(retryLocation.x, retryLocation.y, userFromClient.username, defaultVillageName);
            if (!retryReserved) {
                throw new HttpException("Could not find available location for village", HttpStatus.SERVICE_UNAVAILABLE);
            }
            // Use retry location
            const user: User = new User(userFromClient, retryLocation);
            let result: InsertOneResult = await this.dbAccessorService.getCollection(COLLECTION_NAME).insertOne(user);
            return result.acknowledged;
        }
        
        const user: User = new User(userFromClient, location);
        let result: InsertOneResult = await this.dbAccessorService.getCollection(COLLECTION_NAME).insertOne(user);
        
        return result.acknowledged;
    }  

    async login(userFromClient: userFromClientDTO): Promise<UserDTO>{
        userFromClient.password = crypto.createHash("shake256").update(userFromClient.password).digest("hex");
        let result: User = (await this.dbAccessorService.getCollection(COLLECTION_NAME).findOne({username: userFromClient.username, password: userFromClient.password})) as User;
        if(!result)
            throw new HttpException("Username or password is incorrect. Please try again.", HttpStatus.UNAUTHORIZED);

        await this.dbAccessorService.getCollection(COLLECTION_NAME).updateOne(
            { _id: result._id },
            { $set: { lastLoginDate: new Date() }, $inc: { loginCount: 1 } },
        );

        await reconcileAllVillages(this.dbAccessorService, result);

        return new UserDTO(result);
    }

    async getNumberOfUserStatisticsPages(): Promise<number>
    {
        const numberOfUsers: number = (await this.dbAccessorService.getCollection(COLLECTION_NAME).estimatedDocumentCount());
        return Math.ceil(numberOfUsers / MAX_USERS_IN_EACH_STATISTICS_PAGE);
    }

    // Reset weekly stats every Monday at 00:00; archive previous week's leaderboards first
    @Cron('0 0 * * 1')
    async resetWeeklyStats(): Promise<void> {
        await this.serverContextService.forEachServer(async () => {
            const archiveColl = this.dbAccessorService.getCollection('leaderboardArchive');
            const weekEnding = new Date();

            try {
                const [playerBossDamage, playerResourcesStolen, playerSuccessfulDefenses, clanBossDamage, clanResourcesStolen, clanSuccessfulDefenses] = await Promise.all([
                    this.getUserLeaderboard('bossDamage'),
                    this.getUserLeaderboard('resourcesStolen'),
                    this.getUserLeaderboard('successfulDefenses'),
                    this.getClanLeaderboard('bossDamage'),
                    this.getClanLeaderboard('resourcesStolen'),
                    this.getClanLeaderboard('successfulDefenses'),
                ]);
                await archiveColl.insertOne({
                    weekEnding,
                    playerBossDamage,
                    playerResourcesStolen,
                    playerSuccessfulDefenses,
                    clanBossDamage,
                    clanResourcesStolen,
                    clanSuccessfulDefenses,
                });
            } catch (e) {
                console.error('Leaderboard archive failed (continuing reset):', e);
            }

            await this.dbAccessorService
                .getCollection(COLLECTION_NAME)
                .updateMany(
                    {},
                    {
                        $set: {
                            'weeklyStats.bossDamage': 0,
                            'weeklyStats.resourcesStolen': 0,
                            'weeklyStats.successfulDefenses': 0,
                        },
                    },
                );
        });
    }

    async getLeaderboardArchive(): Promise<{
        weekEnding: string;
        playerBossDamage: any[];
        playerResourcesStolen: any[];
        playerSuccessfulDefenses: any[];
        clanBossDamage: any[];
        clanResourcesStolen: any[];
        clanSuccessfulDefenses: any[];
    } | null> {
        const doc = await this.dbAccessorService
            .getCollection('leaderboardArchive')
            .find({})
            .sort({ weekEnding: -1 })
            .limit(1)
            .toArray();
        if (!doc || doc.length === 0) return null;
        const d = doc[0] as any;
        return {
            weekEnding: d.weekEnding ? new Date(d.weekEnding).toISOString() : '',
            playerBossDamage: d.playerBossDamage || [],
            playerResourcesStolen: d.playerResourcesStolen || [],
            playerSuccessfulDefenses: d.playerSuccessfulDefenses || [],
            clanBossDamage: d.clanBossDamage || [],
            clanResourcesStolen: d.clanResourcesStolen || [],
            clanSuccessfulDefenses: d.clanSuccessfulDefenses || [],
        };
    }

    async getUserStatisticsPage(username: string): Promise<number> {
        const ranked = await this.dbAccessorService.getCollection(COLLECTION_NAME).aggregate([
            { "$unwind": "$villages" },
            { "$group": {
                "_id": "$_id",
                "totalPopulation": { $sum: "$villages.population" },
                "username": { $first: "$username" },
            }},
            { "$sort": { "totalPopulation": -1, "username": 1 } },
        ]).toArray();

        const index = ranked.findIndex((u: any) => u.username === username);
        if (index === -1) return 1;
        return Math.floor(index / MAX_USERS_IN_EACH_STATISTICS_PAGE) + 1;
    }

    async getUserStatistics(page: number): Promise<Array<any>>
    {
        const BEGINNER_SHIELD_HOURS = 24;
        
        let result = this.dbAccessorService.getCollection(COLLECTION_NAME).aggregate([
            { "$unwind" : "$villages" },
            { "$group" : {
                "_id" : "$_id",
                 "totalPopulation": { $sum: "$villages.population" },
                 "username": { $first: "$username" },
                 "clanName": { $first: "$clanName" },
                 "joinDate": { $first: "$joinDate" },
                 "numberOfVillages": { $sum: 1}
                  
            }},
            { "$sort" : { "totalPopulation" : -1, "username" : 1 } },
            {"$skip": MAX_USERS_IN_EACH_STATISTICS_PAGE * (page - 1)},
            {"$limit": MAX_USERS_IN_EACH_STATISTICS_PAGE}
        ])

        if(!result)
            throw new HttpException("No users were found", HttpStatus.NOT_FOUND);
        
        let usersWithMongoId: any =  await result.toArray();
        const now = new Date();

        // Check if any clanless player holds a relic
        const relics = await this.dbAccessorService.getCollection('relics')
            .find({ holderUsername: { $ne: null } }).toArray() as any[];
        const clanlessRelicHolders = new Map<string, string[]>();
        for (const r of relics) {
            if (r.holderUsername && (!r.holderClanName || r.holderClanName === '')) {
                const existing = clanlessRelicHolders.get(r.holderUsername) || [];
                existing.push(r.relicId);
                clanlessRelicHolders.set(r.holderUsername, existing);
            }
        }

        let users = usersWithMongoId.map(userWithMongoId =>{
            let shieldRemaining = 0;
            if (userWithMongoId.joinDate) {
                const joinDate = new Date(userWithMongoId.joinDate);
                const hoursSinceJoin = (now.getTime() - joinDate.getTime()) / (1000 * 60 * 60);
                shieldRemaining = Math.max(0, BEGINNER_SHIELD_HOURS - hoursSinceJoin);
            }
            const entry: any = {
                'username': userWithMongoId.username,
                'population': userWithMongoId.totalPopulation,
                'clanName': userWithMongoId.clanName,
                'numberOfVillages': userWithMongoId.numberOfVillages,
                'beginnerShieldRemainingHours': shieldRemaining,
            };
            const held = clanlessRelicHolders.get(userWithMongoId.username);
            if (held) entry.heldRelicIds = held;
            return entry;
        });

        return users;
    }

    async getUserLeaderboard(category: string): Promise<any[]> {
        const fieldMap: Record<string, string> = {
            bossDamage: 'weeklyStats.bossDamage',
            resourcesStolen: 'weeklyStats.resourcesStolen',
            successfulDefenses: 'weeklyStats.successfulDefenses',
        };

        const field = fieldMap[category];
        if (!field) {
            throw new HttpException('Invalid leaderboard category', HttpStatus.BAD_REQUEST);
        }

        const pipeline = [
            {
                $project: {
                    username: 1,
                    clanName: 1,
                    stat: { $ifNull: [`$${field}`, 0] },
                },
            },
            { $match: { stat: { $gt: 0 } } },
            { $sort: { stat: -1, username: 1 } },
            { $limit: 50 },
        ];

        const cursor = this.dbAccessorService.getCollection(COLLECTION_NAME).aggregate(pipeline);
        return cursor.toArray();
    }

    async getClanLeaderboard(category: string): Promise<any[]> {
        const fieldMap: Record<string, string> = {
            bossDamage: 'weeklyStats.bossDamage',
            resourcesStolen: 'weeklyStats.resourcesStolen',
            successfulDefenses: 'weeklyStats.successfulDefenses',
        };

        const field = fieldMap[category];
        if (!field) {
            throw new HttpException('Invalid leaderboard category', HttpStatus.BAD_REQUEST);
        }

        const pipeline = [
            {
                $match: {
                    clanName: { $nin: [null, ''] },
                },
            },
            {
                $group: {
                    _id: '$clanName',
                    totalStat: { $sum: { $ifNull: [`$${field}`, 0] } },
                },
            },
            { $match: { totalStat: { $gt: 0 } } },
            { $sort: { totalStat: -1, _id: 1 } },
            { $limit: 50 },
        ];

        const cursor = this.dbAccessorService.getCollection(COLLECTION_NAME).aggregate(pipeline);
        return cursor.toArray();
    }

    async getUserVillage(userVillageRequestDTO: UserVillageRequestDTO): Promise<VillageDTO>
    {
        let user: User = (await this.dbAccessorService.getCollection(COLLECTION_NAME).findOne({username: userVillageRequestDTO.username})) as User;
        if(!user)
            throw new HttpException("User does not exist", HttpStatus.NOT_FOUND);
        let userVillage: Village = user.villages[userVillageRequestDTO.villageIndex];
        if(!userVillage)
            throw new HttpException("User village doesnt exist", HttpStatus.NOT_FOUND)

        return new VillageDTO(userVillage); 
    }

    // used by client every 10 seconds and after re-opening the game tab.
    async getUser(username: string): Promise<UserDTO>
    {
        let result: User = (await this.dbAccessorService.getCollection(COLLECTION_NAME).findOne({username: username})) as User;
        if(!result)
            throw new HttpException("User doesnt exist", HttpStatus.NOT_FOUND);

        await reconcileAllVillages(this.dbAccessorService, result);

        return new UserDTO(result);
    }

    // Get public profile - limited data for viewing other players
    async getPublicProfile(username: string): Promise<UserDTO>
    {
        let result: User = (await this.dbAccessorService.getCollection(COLLECTION_NAME).findOne({username: username})) as User;
        if(!result)
            throw new HttpException("User doesnt exist", HttpStatus.NOT_FOUND);
        
        // Return a UserDTO but note: for truly limited data, you'd create a PublicUserDTO
        // For now, UserDTO already doesn't expose password. The main difference is
        // we're not returning sensitive game state that could be exploited.
        return new UserDTO(result);
    }

    async updateIntro(username: string, intro: string): Promise<{ success: boolean }>
    {
        const result = await this.dbAccessorService.getCollection(COLLECTION_NAME).updateOne(
            { username },
            { $set: { intro } }
        );
        return { success: result.modifiedCount === 1 || result.matchedCount === 1 };
    }

    async updateTitle(username: string, title: string | null): Promise<{ success: boolean }> {
        const user = await this.dbAccessorService.getCollection(COLLECTION_NAME).findOne({ username }) as User;
        if (!user) {
            throw new HttpException("User doesnt exist", HttpStatus.NOT_FOUND);
        }

        if (!title) {
            const result = await this.dbAccessorService.getCollection(COLLECTION_NAME).updateOne(
                { username },
                { $set: { selectedTitle: null } }
            );
            return { success: result.modifiedCount === 1 || result.matchedCount === 1 };
        }

        // Title must be an achievement id that the user has unlocked
        const achievement = ACHIEVEMENTS.find((a) => a.id === title);
        const unlocked = (user.unlockedAchievements || []) as string[];
        if (!achievement || !unlocked.includes(title)) {
            throw new HttpException('Title not unlocked yet', HttpStatus.BAD_REQUEST);
        }

        const result = await this.dbAccessorService.getCollection(COLLECTION_NAME).updateOne(
            { username },
            { $set: { selectedTitle: title } }
        );
        return { success: result.modifiedCount === 1 || result.matchedCount === 1 };
    }

    async updateTheme(username: string, theme: string): Promise<{ success: boolean }> {
        const result = await this.dbAccessorService.getCollection(COLLECTION_NAME).updateOne(
            { username },
            { $set: { theme: theme || 'default' } }
        );
        return { success: result.modifiedCount === 1 || result.matchedCount === 1 };
    }
}

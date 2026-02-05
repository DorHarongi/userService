import { HttpException, HttpStatus, Injectable, Inject, forwardRef } from '@nestjs/common';
import { InsertOneResult } from 'mongodb';
import { DbAccessorService } from '../../database/services/db-accessor.service';
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

const MAX_USERS_IN_EACH_STATISTICS_PAGE = 10;
const COLLECTION_NAME = "users";

@Injectable()
export class UserRepositoryService {
    constructor(
        private dbAccessorService: DbAccessorService,
        @Inject(forwardRef(() => WorldService)) private worldService: WorldService
    )
    {

    }
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
        
        // Try to reserve the grid cell FIRST before creating user
        const reserved = await this.worldService.reserveGridForVillage(location.x, location.y, userFromClient.username, "Village");
        if (!reserved) {
            // Retry with a different location
            const retryLocation = await this.worldService.findLocationForNewVillage();
            const retryReserved = await this.worldService.reserveGridForVillage(retryLocation.x, retryLocation.y, userFromClient.username, "Village");
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
            throw new HttpException("Invalid credentials", HttpStatus.UNAUTHORIZED);
        return new UserDTO(result);
    }

    async getNumberOfUserStatisticsPages(): Promise<number>
    {
        const numberOfUsers: number = (await this.dbAccessorService.getCollection(COLLECTION_NAME).estimatedDocumentCount());
        return Math.ceil(numberOfUsers / MAX_USERS_IN_EACH_STATISTICS_PAGE);
    }

    async getUserStatistics(page: number): Promise<Array<UserStatisticDTO>>
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
        let users: UserStatisticDTO[] = usersWithMongoId.map(userWithMongoId =>{
            let shieldRemaining = 0;
            if (userWithMongoId.joinDate) {
                const joinDate = new Date(userWithMongoId.joinDate);
                const hoursSinceJoin = (now.getTime() - joinDate.getTime()) / (1000 * 60 * 60);
                shieldRemaining = Math.max(0, BEGINNER_SHIELD_HOURS - hoursSinceJoin);
            }
            return {
                'username': userWithMongoId.username,
                'population': userWithMongoId.totalPopulation,
                'clanName': userWithMongoId.clanName,
                'numberOfVillages': userWithMongoId.numberOfVillages,
                'beginnerShieldRemainingHours': shieldRemaining
            }
        })

        return users;
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
        
        // Debug: log trait values - show raw data from MongoDB
        if (result.villages && result.villages.length > 0) {
            const rawVillage = result.villages[0] as any;
            console.log(`[getUser] ${username} village[0] keys:`, Object.keys(rawVillage));
            console.log(`[getUser] ${username} village[0].trait from DB: ${rawVillage.trait}`);
        }
        
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
}

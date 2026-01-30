import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { DbAccessorService } from '../../database/services/db-accessor.service';
import { Clan, IClan } from '../models/clan.entity';
import { ClanDTO, ClanStatisticDTO, CreateClanDTO, HandleJoinRequestDTO, JoinClanRequestDTO, LeaveClanDTO } from '../dtos/clanDTO';
import { User } from '../../user/models/user.entity';
import { embassyMinimumLevelForClanJoin } from 'utils';

const CLANS_COLLECTION = "clans";
const USERS_COLLECTION = "users";
const MAX_CLANS_IN_EACH_STATISTICS_PAGE = 10;

@Injectable()
export class ClansService {
    constructor(private dbAccessorService: DbAccessorService) {}

    async createClan(createClanDTO: CreateClanDTO): Promise<ClanDTO> {
        // Check if clan name already exists
        const existingClan = await this.dbAccessorService.getCollection(CLANS_COLLECTION).findOne({ clanName: createClanDTO.clanName });
        if (existingClan) {
            throw new HttpException("Clan name already exists", HttpStatus.CONFLICT);
        }

        // Check if user exists and doesn't already have a clan
        const user = await this.dbAccessorService.getCollection(USERS_COLLECTION).findOne({ username: createClanDTO.leaderUsername }) as User;
        if (!user) {
            throw new HttpException("User not found", HttpStatus.NOT_FOUND);
        }
        if (user.clanName && user.clanName !== "") {
            throw new HttpException("User already belongs to a clan", HttpStatus.BAD_REQUEST);
        }

        // Check embassy level in any village
        const hasRequiredEmbassyLevel = user.villages?.some(
            v => v.buildingsLevels.embassyLevel >= embassyMinimumLevelForClanJoin
        );
        if (!hasRequiredEmbassyLevel) {
            throw new HttpException(
                `Embassy must be level ${embassyMinimumLevelForClanJoin} or higher to create a clan`,
                HttpStatus.BAD_REQUEST
            );
        }

        const clan = new Clan(createClanDTO.clanName, createClanDTO.description, createClanDTO.leaderUsername, createClanDTO.isOpen);
        await this.dbAccessorService.getCollection(CLANS_COLLECTION).insertOne(clan);

        // Update user's clan name
        await this.dbAccessorService.getCollection(USERS_COLLECTION).updateOne(
            { username: createClanDTO.leaderUsername },
            { $set: { clanName: createClanDTO.clanName } }
        );

        return new ClanDTO(clan);
    }

    async getClan(clanName: string): Promise<ClanDTO> {
        const clan = await this.dbAccessorService.getCollection(CLANS_COLLECTION).findOne({ clanName }) as Clan;
        if (!clan) {
            throw new HttpException("Clan not found", HttpStatus.NOT_FOUND);
        }
        return new ClanDTO(clan);
    }

    async getNumberOfClanStatisticsPages(): Promise<number> {
        const numberOfClans: number = await this.dbAccessorService.getCollection(CLANS_COLLECTION).estimatedDocumentCount();
        return Math.ceil(numberOfClans / MAX_CLANS_IN_EACH_STATISTICS_PAGE);
    }

    async getClanStatistics(page: number): Promise<ClanStatisticDTO[]> {
        // Aggregate clan statistics with total population from members
        const result = await this.dbAccessorService.getCollection(CLANS_COLLECTION).aggregate([
            {
                $lookup: {
                    from: USERS_COLLECTION,
                    localField: "members",
                    foreignField: "username",
                    as: "memberUsers"
                }
            },
            {
                $addFields: {
                    totalPopulation: {
                        $sum: {
                            $map: {
                                input: "$memberUsers",
                                as: "user",
                                in: {
                                    $sum: {
                                        $map: {
                                            input: "$$user.villages",
                                            as: "village",
                                            in: "$$village.population"
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            { $sort: { totalPopulation: -1, clanName: 1 } },
            { $skip: MAX_CLANS_IN_EACH_STATISTICS_PAGE * (page - 1) },
            { $limit: MAX_CLANS_IN_EACH_STATISTICS_PAGE },
            {
                $project: {
                    clanName: 1,
                    description: 1,
                    leaderUsername: 1,
                    memberCount: { $size: "$members" },
                    totalPopulation: 1,
                    isOpen: 1
                }
            }
        ]).toArray();

        return result as ClanStatisticDTO[];
    }

    async requestToJoinClan(joinRequest: JoinClanRequestDTO): Promise<{ success: boolean }> {
        const clan = await this.dbAccessorService.getCollection(CLANS_COLLECTION).findOne({ clanName: joinRequest.clanName }) as Clan;
        if (!clan) {
            throw new HttpException("Clan not found", HttpStatus.NOT_FOUND);
        }

        const user = await this.dbAccessorService.getCollection(USERS_COLLECTION).findOne({ username: joinRequest.username }) as User;
        if (!user) {
            throw new HttpException("User not found", HttpStatus.NOT_FOUND);
        }
        if (user.clanName && user.clanName !== "") {
            throw new HttpException("User already belongs to a clan", HttpStatus.BAD_REQUEST);
        }

        // Check if already requested
        if (user.pendingClanRequests && user.pendingClanRequests.includes(joinRequest.clanName)) {
            throw new HttpException("Already requested to join this clan", HttpStatus.BAD_REQUEST);
        }

        if (clan.isOpen) {
            // Instant join for open clans
            await this.addMemberToClan(joinRequest.clanName, joinRequest.username);
            return { success: true };
        } else {
            // Add to pending requests for closed clans
            await this.dbAccessorService.getCollection(CLANS_COLLECTION).updateOne(
                { clanName: joinRequest.clanName },
                {
                    $push: {
                        pendingRequests: {
                            username: joinRequest.username,
                            message: joinRequest.message || "",
                            requestDate: new Date()
                        }
                    }
                } as any
            );

            // Track pending request on user side
            await this.dbAccessorService.getCollection(USERS_COLLECTION).updateOne(
                { username: joinRequest.username },
                { $push: { pendingClanRequests: joinRequest.clanName } } as any
            );

            return { success: true };
        }
    }

    async handleJoinRequest(handleRequest: HandleJoinRequestDTO): Promise<{ success: boolean }> {
        const clan = await this.dbAccessorService.getCollection(CLANS_COLLECTION).findOne({ clanName: handleRequest.clanName }) as Clan;
        if (!clan) {
            throw new HttpException("Clan not found", HttpStatus.NOT_FOUND);
        }

        if (clan.leaderUsername !== handleRequest.leaderUsername) {
            throw new HttpException("Only the clan leader can handle join requests", HttpStatus.FORBIDDEN);
        }

        // Remove from pending requests
        await this.dbAccessorService.getCollection(CLANS_COLLECTION).updateOne(
            { clanName: handleRequest.clanName },
            { $pull: { pendingRequests: { username: handleRequest.requestUsername } } } as any
        );

        // Remove from user's pending clan requests
        await this.dbAccessorService.getCollection(USERS_COLLECTION).updateOne(
            { username: handleRequest.requestUsername },
            { $pull: { pendingClanRequests: handleRequest.clanName } } as any
        );

        if (handleRequest.accept) {
            await this.addMemberToClan(handleRequest.clanName, handleRequest.requestUsername);
        }

        return { success: true };
    }

    private async addMemberToClan(clanName: string, username: string): Promise<void> {
        await this.dbAccessorService.getCollection(CLANS_COLLECTION).updateOne(
            { clanName },
            { $addToSet: { members: username } } as any
        );

        await this.dbAccessorService.getCollection(USERS_COLLECTION).updateOne(
            { username },
            { 
                $set: { clanName: clanName },
                $pull: { pendingClanRequests: clanName }
            } as any
        );
    }

    async leaveClan(leaveClanDTO: LeaveClanDTO): Promise<{ success: boolean }> {
        const clan = await this.dbAccessorService.getCollection(CLANS_COLLECTION).findOne({ clanName: leaveClanDTO.clanName }) as Clan;
        if (!clan) {
            throw new HttpException("Clan not found", HttpStatus.NOT_FOUND);
        }

        if (clan.leaderUsername === leaveClanDTO.username) {
            // If leader leaves, either transfer leadership or dissolve clan
            if (clan.members.length > 1) {
                // Transfer to next member
                const newLeader = clan.members.find(m => m !== leaveClanDTO.username);
                await this.dbAccessorService.getCollection(CLANS_COLLECTION).updateOne(
                    { clanName: leaveClanDTO.clanName },
                    { 
                        $set: { leaderUsername: newLeader },
                        $pull: { members: leaveClanDTO.username }
                    } as any
                );
            } else {
                // Dissolve clan
                await this.dbAccessorService.getCollection(CLANS_COLLECTION).deleteOne({ clanName: leaveClanDTO.clanName });
            }
        } else {
            // Regular member leaving
            await this.dbAccessorService.getCollection(CLANS_COLLECTION).updateOne(
                { clanName: leaveClanDTO.clanName },
                { $pull: { members: leaveClanDTO.username } } as any
            );
        }

        // Clear user's clan
        await this.dbAccessorService.getCollection(USERS_COLLECTION).updateOne(
            { username: leaveClanDTO.username },
            { $set: { clanName: "" } }
        );

        return { success: true };
    }

    async getClanMembers(clanName: string): Promise<string[]> {
        const clan = await this.dbAccessorService.getCollection(CLANS_COLLECTION).findOne({ clanName }) as Clan;
        if (!clan) {
            throw new HttpException("Clan not found", HttpStatus.NOT_FOUND);
        }
        return clan.members;
    }

    async areUsersInSameClan(username1: string, username2: string): Promise<boolean> {
        const user1 = await this.dbAccessorService.getCollection(USERS_COLLECTION).findOne({ username: username1 }) as User;
        const user2 = await this.dbAccessorService.getCollection(USERS_COLLECTION).findOne({ username: username2 }) as User;
        
        if (!user1 || !user2) return false;
        if (!user1.clanName || !user2.clanName || user1.clanName === "" || user2.clanName === "") return false;
        
        return user1.clanName === user2.clanName;
    }

    async kickMember(clanName: string, leaderUsername: string, memberUsername: string): Promise<{ success: boolean }> {
        const clan = await this.dbAccessorService.getCollection(CLANS_COLLECTION).findOne({ clanName }) as Clan;
        if (!clan) {
            throw new HttpException("Clan not found", HttpStatus.NOT_FOUND);
        }

        if (clan.leaderUsername !== leaderUsername) {
            throw new HttpException("Only the clan leader can kick members", HttpStatus.FORBIDDEN);
        }

        if (leaderUsername === memberUsername) {
            throw new HttpException("You cannot kick yourself", HttpStatus.BAD_REQUEST);
        }

        if (!clan.members.includes(memberUsername)) {
            throw new HttpException("User is not a member of this clan", HttpStatus.BAD_REQUEST);
        }

        // Remove member from clan
        await this.dbAccessorService.getCollection(CLANS_COLLECTION).updateOne(
            { clanName },
            { $pull: { members: memberUsername } } as any
        );

        // Clear user's clan
        await this.dbAccessorService.getCollection(USERS_COLLECTION).updateOne(
            { username: memberUsername },
            { $set: { clanName: "" } }
        );

        return { success: true };
    }

    async updateClanName(oldClanName: string, newClanName: string, leaderUsername: string): Promise<{ success: boolean }> {
        const clan = await this.dbAccessorService.getCollection(CLANS_COLLECTION).findOne({ clanName: oldClanName }) as Clan;
        if (!clan) {
            throw new HttpException("Clan not found", HttpStatus.NOT_FOUND);
        }

        if (clan.leaderUsername !== leaderUsername) {
            throw new HttpException("Only the clan leader can update the clan name", HttpStatus.FORBIDDEN);
        }

        // Check if new name already exists
        const existingClan = await this.dbAccessorService.getCollection(CLANS_COLLECTION).findOne({ clanName: newClanName });
        if (existingClan) {
            throw new HttpException("Clan name already exists", HttpStatus.CONFLICT);
        }

        // Update clan name
        await this.dbAccessorService.getCollection(CLANS_COLLECTION).updateOne(
            { clanName: oldClanName },
            { $set: { clanName: newClanName } }
        );

        // Update all members' clanName
        await this.dbAccessorService.getCollection(USERS_COLLECTION).updateMany(
            { clanName: oldClanName },
            { $set: { clanName: newClanName } }
        );

        // Update pending clan requests to the new name
        await this.dbAccessorService.getCollection(USERS_COLLECTION).updateMany(
            { pendingClanRequests: oldClanName },
            { $set: { "pendingClanRequests.$": newClanName } }
        );

        return { success: true };
    }
}

import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import {
  embassyMinimumLevelForClanJoin,
  MAX_CLAN_MEMBERS,
  RELIC_NAMES,
  calculateDistance,
  getArmySpeed,
  calculateTravelTimeMs,
  EMPTY_SKILLS,
  getEffectiveSpeedBonus,
} from 'utils';
import { AnnouncementsService } from '../../announcements/announcements.service';
import { DbAccessorService } from '../../database/services/db-accessor.service';
import { MessagesService } from '../../messages/services/messages.service';
import { RelicsService } from '../../relics/relics.service';
import { getVillageRelicIds } from '../../relics/relic-bonus.helper';
import { User } from '../../user/models/user.entity';
import {
  ClanDTO,
  ClanMemberRaidStatsDTO,
  ClanStatisticDTO,
  CreateClanDTO,
  HandleJoinRequestDTO,
  JoinClanRequestDTO,
  LeaveClanDTO,
  ToggleClanOpenDTO,
} from '../dtos/clanDTO';
import { Clan } from '../models/clan.entity';

const CLANS_COLLECTION = 'clans';
const USERS_COLLECTION = 'users';
const RELICS_COLLECTION = 'relics';
const MOVEMENTS_COLLECTION = 'movements';
const MAX_CLANS_IN_EACH_STATISTICS_PAGE = 10;

@Injectable()
export class ClansService {
  constructor(
    private dbAccessorService: DbAccessorService,
    private relicsService: RelicsService,
    private announcementsService: AnnouncementsService,
    private messagesService: MessagesService,
  ) {}

  async createClan(createClanDTO: CreateClanDTO): Promise<ClanDTO> {
    const trimmedName = (createClanDTO.clanName || '').trim();
    if (!trimmedName) {
      throw new HttpException('Clan name is required', HttpStatus.BAD_REQUEST);
    }
    if (trimmedName.length > 15) {
      throw new HttpException('Clan name cannot exceed 15 characters', HttpStatus.BAD_REQUEST);
    }
    createClanDTO.clanName = trimmedName;

    // Check if clan name already exists
    const existingClan = await this.dbAccessorService
      .getCollection(CLANS_COLLECTION)
      .findOne({ clanName: createClanDTO.clanName });
    if (existingClan) {
      throw new HttpException('Clan name already exists', HttpStatus.CONFLICT);
    }

    // Check if user exists and doesn't already have a clan
    const user = (await this.dbAccessorService
      .getCollection(USERS_COLLECTION)
      .findOne({ username: createClanDTO.leaderUsername })) as User;
    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }
    if (user.clanName && user.clanName !== '') {
      throw new HttpException(
        'User already belongs to a clan',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Check embassy level in any village
    const hasRequiredEmbassyLevel = user.villages?.some(
      (v) => v.buildingsLevels.embassyLevel >= embassyMinimumLevelForClanJoin,
    );
    if (!hasRequiredEmbassyLevel) {
      throw new HttpException(
        `Embassy must be level ${embassyMinimumLevelForClanJoin} or higher to create a clan`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const clan = new Clan(
      createClanDTO.clanName,
      createClanDTO.description,
      createClanDTO.leaderUsername,
      createClanDTO.isOpen,
    );
    await this.dbAccessorService
      .getCollection(CLANS_COLLECTION)
      .insertOne(clan);

    // Update user's clan name and clear any pending join requests
    const pendingRequests = user.pendingClanRequests || [];
    await this.dbAccessorService
      .getCollection(USERS_COLLECTION)
      .updateOne(
        { username: createClanDTO.leaderUsername },
        { $set: { clanName: createClanDTO.clanName, pendingClanRequests: [] } },
      );

    // Remove this user from all clans' pendingRequests arrays
    if (pendingRequests.length > 0) {
      await this.dbAccessorService
        .getCollection(CLANS_COLLECTION)
        .updateMany(
          { clanName: { $in: pendingRequests } },
          { $pull: { pendingRequests: { username: createClanDTO.leaderUsername } } } as any,
        );
    }

    // Update relic holder clan (if leader had relics when clanless) - does NOT touch transferCooldownUntil
    await this.relicsService.updateHolderClanForUser(
      createClanDTO.leaderUsername,
      createClanDTO.clanName,
    );

    return new ClanDTO(clan);
  }

  async getClan(clanName: string): Promise<ClanDTO> {
    const clan = (await this.dbAccessorService
      .getCollection(CLANS_COLLECTION)
      .findOne({ clanName })) as Clan;
    if (!clan) {
      throw new HttpException('Clan not found', HttpStatus.NOT_FOUND);
    }
    return new ClanDTO(clan);
  }

  async getNumberOfClanStatisticsPages(): Promise<number> {
    const numberOfClans: number = await this.dbAccessorService
      .getCollection(CLANS_COLLECTION)
      .estimatedDocumentCount();
    return Math.ceil(numberOfClans / MAX_CLANS_IN_EACH_STATISTICS_PAGE);
  }

  async getClanStatisticsPage(clanName: string): Promise<number> {
    const ranked = await this.dbAccessorService
      .getCollection(CLANS_COLLECTION)
      .aggregate([
        {
          $lookup: {
            from: USERS_COLLECTION,
            localField: 'members',
            foreignField: 'username',
            as: 'memberUsers',
          },
        },
        {
          $addFields: {
            totalPopulation: {
              $sum: {
                $map: {
                  input: '$memberUsers',
                  as: 'user',
                  in: { $sum: { $map: { input: '$$user.villages', as: 'village', in: '$$village.population' } } },
                },
              },
            },
          },
        },
        { $sort: { totalPopulation: -1, clanName: 1 } },
        { $project: { clanName: 1 } },
      ])
      .toArray();

    const index = ranked.findIndex((c: any) => c.clanName === clanName);
    if (index === -1) return 1;
    return Math.floor(index / MAX_CLANS_IN_EACH_STATISTICS_PAGE) + 1;
  }

  async getClanStatistics(page: number): Promise<ClanStatisticDTO[]> {
    // Aggregate clan statistics with total population from members
    const result = await this.dbAccessorService
      .getCollection(CLANS_COLLECTION)
      .aggregate([
        {
          $lookup: {
            from: USERS_COLLECTION,
            localField: 'members',
            foreignField: 'username',
            as: 'memberUsers',
          },
        },
        {
          $addFields: {
            totalPopulation: {
              $sum: {
                $map: {
                  input: '$memberUsers',
                  as: 'user',
                  in: {
                    $sum: {
                      $map: {
                        input: '$$user.villages',
                        as: 'village',
                        in: '$$village.population',
                      },
                    },
                  },
                },
              },
            },
          },
        },
        { $sort: { totalPopulation: -1, clanName: 1 } },
        { $skip: MAX_CLANS_IN_EACH_STATISTICS_PAGE * (page - 1) },
        { $limit: MAX_CLANS_IN_EACH_STATISTICS_PAGE },
        {
          $lookup: {
            from: RELICS_COLLECTION,
            let: { cn: '$clanName' },
            pipeline: [
              { $match: { $expr: { $eq: ['$holderClanName', '$$cn'] } } },
              { $project: { relicId: 1 } },
            ],
            as: 'relicDocs',
          },
        },
        {
          $project: {
            clanName: 1,
            description: 1,
            leaderUsername: 1,
            memberCount: { $size: '$members' },
            totalPopulation: 1,
            isOpen: 1,
            totalBossesKilled: { $ifNull: ['$totalBossesKilled', 0] },
            heldRelicIds: {
              $map: { input: '$relicDocs', as: 'r', in: '$$r.relicId' },
            },
          },
        },
      ])
      .toArray();

    return result as ClanStatisticDTO[];
  }

  async getClanMemberRaidStats(
    clanName: string,
  ): Promise<ClanMemberRaidStatsDTO[]> {
    const clan = (await this.dbAccessorService
      .getCollection(CLANS_COLLECTION)
      .findOne({ clanName })) as Clan;
    if (!clan) {
      throw new HttpException('Clan not found', HttpStatus.NOT_FOUND);
    }

    const members = await this.dbAccessorService
      .getCollection(USERS_COLLECTION)
      .find({ username: { $in: clan.members } })
      .project({ username: 1, weeklyRaidDamage: 1, villages: 1 })
      .toArray();

    return members
      .map((m) => ({
        username: m.username,
        weeklyRaidDamage: m.weeklyRaidDamage || 0,
        totalPopulation: (m.villages || []).reduce(
          (sum: number, v: any) => sum + (v.population || 0),
          0,
        ),
      }))
      .sort((a, b) => b.totalPopulation - a.totalPopulation);
  }

  async requestToJoinClan(
    joinRequest: JoinClanRequestDTO,
  ): Promise<{ success: boolean }> {
    const clan = (await this.dbAccessorService
      .getCollection(CLANS_COLLECTION)
      .findOne({ clanName: joinRequest.clanName })) as Clan;
    if (!clan) {
      throw new HttpException('Clan not found', HttpStatus.NOT_FOUND);
    }

    const user = (await this.dbAccessorService
      .getCollection(USERS_COLLECTION)
      .findOne({ username: joinRequest.username })) as User;
    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }
    if (user.clanName && user.clanName !== '') {
      throw new HttpException(
        'User already belongs to a clan',
        HttpStatus.BAD_REQUEST,
      );
    }

    const hasRequiredEmbassy = user.villages?.some(
      (v) => v.buildingsLevels.embassyLevel >= embassyMinimumLevelForClanJoin,
    );
    if (!hasRequiredEmbassy) {
      throw new HttpException(
        `Embassy must be level ${embassyMinimumLevelForClanJoin} or higher to join a clan`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // Check if already requested
    if (
      user.pendingClanRequests &&
      user.pendingClanRequests.includes(joinRequest.clanName)
    ) {
      throw new HttpException(
        'Already requested to join this clan',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (clan.members && clan.members.length >= MAX_CLAN_MEMBERS) {
      throw new HttpException(
        'Clan is full (max ' + MAX_CLAN_MEMBERS + ' members)',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (clan.isOpen) {
      // Instant join for open clans
      await this.addMemberToClan(joinRequest.clanName, joinRequest.username);
      return { success: true };
    } else {
      // Add to pending requests for closed clans
      await this.dbAccessorService
        .getCollection(CLANS_COLLECTION)
        .updateOne({ clanName: joinRequest.clanName }, {
          $push: {
            pendingRequests: {
              username: joinRequest.username,
              message: joinRequest.message || '',
              requestDate: new Date(),
            },
          },
        } as any);

      // Track pending request on user side
      await this.dbAccessorService
        .getCollection(USERS_COLLECTION)
        .updateOne({ username: joinRequest.username }, {
          $push: { pendingClanRequests: joinRequest.clanName },
        } as any);

      return { success: true };
    }
  }

  async handleJoinRequest(
    handleRequest: HandleJoinRequestDTO,
  ): Promise<{ success: boolean }> {
    const clan = (await this.dbAccessorService
      .getCollection(CLANS_COLLECTION)
      .findOne({ clanName: handleRequest.clanName })) as Clan;
    if (!clan) {
      throw new HttpException('Clan not found', HttpStatus.NOT_FOUND);
    }

    if (clan.leaderUsername !== handleRequest.leaderUsername) {
      throw new HttpException(
        'Only the clan leader can handle join requests',
        HttpStatus.FORBIDDEN,
      );
    }

    const pendingRequest = (clan as any).pendingRequests?.find(
      (r: any) => r.username === handleRequest.requestUsername,
    );
    if (!pendingRequest) {
      throw new HttpException(
        'Join request not found or already handled',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Remove from pending requests
    await this.dbAccessorService
      .getCollection(CLANS_COLLECTION)
      .updateOne({ clanName: handleRequest.clanName }, {
        $pull: { pendingRequests: { username: handleRequest.requestUsername } },
      } as any);

    // Remove from user's pending clan requests
    await this.dbAccessorService
      .getCollection(USERS_COLLECTION)
      .updateOne({ username: handleRequest.requestUsername }, {
        $pull: { pendingClanRequests: handleRequest.clanName },
      } as any);

    if (handleRequest.accept) {
      if (clan.members && clan.members.length >= MAX_CLAN_MEMBERS) {
        throw new HttpException(
          'Clan is full (max ' + MAX_CLAN_MEMBERS + ' members)',
          HttpStatus.BAD_REQUEST,
        );
      }

      // Verify the player doesn't already have a clan (Bug 7 fix)
      const user = (await this.dbAccessorService
        .getCollection(USERS_COLLECTION)
        .findOne({ username: handleRequest.requestUsername })) as User;
      if (user?.clanName && user.clanName !== '') {
        throw new HttpException(
          'This player already has a clan',
          HttpStatus.BAD_REQUEST,
        );
      }

      await this.addMemberToClan(
        handleRequest.clanName,
        handleRequest.requestUsername,
      );
    }

    return { success: true };
  }

  private async addMemberToClan(
    clanName: string,
    username: string,
  ): Promise<void> {
    await this.dbAccessorService
      .getCollection(CLANS_COLLECTION)
      .updateOne({ clanName }, { $addToSet: { members: username } } as any);

    await this.dbAccessorService
      .getCollection(USERS_COLLECTION)
      .updateOne({ username }, {
        $set: { clanName: clanName },
        $pull: { pendingClanRequests: clanName },
      } as any);

    await this.relicsService.updateHolderClanForUser(username, clanName);
    const heldRelicIds = await this.relicsService.getRelicIdsHeldByUser(
      username,
    );

    if (heldRelicIds.length > 0) {
      const relicNamesList = heldRelicIds
        .map((id) => RELIC_NAMES.find((r) => r.id === id)?.name ?? id)
        .join(', ');

      const clan = (await this.dbAccessorService
        .getCollection(CLANS_COLLECTION)
        .findOne({ clanName })) as Clan;
      if (clan) {
        for (const member of clan.members) {
          await this.messagesService.sendClanNotificationMessage(
            member,
            'A Divine Relic Has Arrived!',
            `{player:${username}} has joined the clan bringing the ${relicNamesList}! Your clan grows stronger.`,
          );
        }
      }
    }
  }

  async leaveClan(leaveClanDTO: LeaveClanDTO): Promise<{ success: boolean }> {
    const clan = (await this.dbAccessorService
      .getCollection(CLANS_COLLECTION)
      .findOne({ clanName: leaveClanDTO.clanName })) as Clan;
    if (!clan) {
      throw new HttpException('Clan not found', HttpStatus.NOT_FOUND);
    }

    // Withdraw all support troops the leaving player has sent to clan members
    await this.withdrawAllSupportTroops(leaveClanDTO.username);
    // Return all support troops other clan members sent to the leaving player
    await this.returnReceivedSupportTroops(leaveClanDTO.username);

    if (clan.leaderUsername === leaveClanDTO.username) {
      if (clan.members.length > 1) {
        const newLeader = leaveClanDTO.newLeaderUsername
          && clan.members.includes(leaveClanDTO.newLeaderUsername)
          && leaveClanDTO.newLeaderUsername !== leaveClanDTO.username
            ? leaveClanDTO.newLeaderUsername
            : clan.members.find((m) => m !== leaveClanDTO.username);
        await this.dbAccessorService
          .getCollection(CLANS_COLLECTION)
          .updateOne({ clanName: leaveClanDTO.clanName }, {
            $set: { leaderUsername: newLeader },
            $pull: { members: leaveClanDTO.username },
          } as any);
      } else {
        // Dissolve clan
        await this.dbAccessorService
          .getCollection(CLANS_COLLECTION)
          .deleteOne({ clanName: leaveClanDTO.clanName });
      }
    } else {
      // Regular member leaving
      await this.dbAccessorService
        .getCollection(CLANS_COLLECTION)
        .updateOne({ clanName: leaveClanDTO.clanName }, {
          $pull: { members: leaveClanDTO.username },
        } as any);
    }

    // Clear user's clan
    await this.dbAccessorService
      .getCollection(USERS_COLLECTION)
      .updateOne(
        { username: leaveClanDTO.username },
        { $set: { clanName: '' } },
      );

    const heldRelicIds = await this.relicsService.getRelicIdsHeldByUser(
      leaveClanDTO.username,
    );
    await this.relicsService.updateHolderClanForUser(
      leaveClanDTO.username,
      null,
    );

    if (heldRelicIds.length > 0) {
      const relicNamesList = heldRelicIds
        .map((id) => RELIC_NAMES.find((r) => r.id === id)?.name ?? id)
        .join(', ');

      for (const member of clan.members) {
        if (member === leaveClanDTO.username) continue;
        await this.messagesService.sendClanNotificationMessage(
          member,
          'A Relic Has Been Lost!',
            `{player:${leaveClanDTO.username}} has left the clan and taken the ${relicNamesList} with them. Your clan no longer controls this relic.`,
        );
      }
    }

    return { success: true };
  }

  private subtractClanTroops(
    clanTroops: any,
    troops: any,
  ): void {
    clanTroops.spearFighters = Math.max(0, (clanTroops.spearFighters || 0) - (troops.spearFighters || 0));
    clanTroops.swordFighters = Math.max(0, (clanTroops.swordFighters || 0) - (troops.swordFighters || 0));
    clanTroops.axeFighters = Math.max(0, (clanTroops.axeFighters || 0) - (troops.axeFighters || 0));
    clanTroops.archers = Math.max(0, (clanTroops.archers || 0) - (troops.archers || 0));
    clanTroops.magicians = Math.max(0, (clanTroops.magicians || 0) - (troops.magicians || 0));
    clanTroops.horsemen = Math.max(0, (clanTroops.horsemen || 0) - (troops.horsemen || 0));
    clanTroops.catapults = Math.max(0, (clanTroops.catapults || 0) - (troops.catapults || 0));
  }

  private async createReturnMovement(
    senderVillage: any,
    recipientVillage: any,
    ownerUsername: string,
    ownerVillageName: string,
    troops: any,
  ): Promise<any> {
    const distance = calculateDistance(
      senderVillage.location.x,
      senderVillage.location.y,
      recipientVillage.location.x,
      recipientVillage.location.y,
    );
    const armySpeed = getArmySpeed(troops as any);
    const ownerRelicIds = await getVillageRelicIds(
      this.dbAccessorService,
      ownerUsername,
      ownerVillageName,
    );
    const travelTimeMs = calculateTravelTimeMs(
      distance,
      armySpeed,
      getEffectiveSpeedBonus(
        recipientVillage?.skills ?? EMPTY_SKILLS,
        ownerRelicIds,
      ),
    );
    const departureTime = new Date();
    const arrivalTime = new Date(departureTime.getTime() + travelTimeMs);

    return {
      type: 'return',
      senderUsername: ownerUsername,
      senderVillageName: ownerVillageName,
      targetUsername: ownerUsername,
      targetVillageName: ownerVillageName,
      troops,
      departureTime,
      arrivalTime,
      status: 'in_transit',
    };
  }

  async withdrawAllSupportTroops(username: string): Promise<void> {
    const user = (await this.dbAccessorService
      .getCollection(USERS_COLLECTION)
      .findOne({ username })) as User;
    if (!user) return;

    for (const village of user.villages) {
      if (!village.supportSent || village.supportSent.length === 0) continue;

      for (const support of village.supportSent) {
        const recipient = (await this.dbAccessorService
          .getCollection(USERS_COLLECTION)
          .findOne({ username: support.recipientUsername })) as User;
        if (!recipient) continue;

        const recipientVillage = recipient.villages.find(
          (v) => v.villageName === support.recipientVillageName,
        );
        if (!recipientVillage || !recipientVillage.clanTroops) continue;

        this.subtractClanTroops(recipientVillage.clanTroops, support.troops);

        await this.dbAccessorService
          .getCollection(USERS_COLLECTION)
          .updateOne(
            { username: support.recipientUsername },
            { $set: recipient },
          );

        // Create return movement (troops travel back at slowest unit speed)
        const movement = await this.createReturnMovement(
          recipientVillage,
          village,
          username,
          village.villageName,
          { ...support.troops },
        );
        await this.dbAccessorService
          .getCollection(MOVEMENTS_COLLECTION)
          .insertOne(movement);
      }

      village.supportSent = [];
    }

    await this.dbAccessorService
      .getCollection(USERS_COLLECTION)
      .updateOne({ username }, { $set: user });
  }

  async returnReceivedSupportTroops(username: string): Promise<void> {
    const allSenders = await this.dbAccessorService
      .getCollection(USERS_COLLECTION)
      .find({ 'villages.supportSent.recipientUsername': username })
      .toArray() as User[];

    if (allSenders.length === 0) return;

    // Load the leaving user once
    const leavingUser = (await this.dbAccessorService
      .getCollection(USERS_COLLECTION)
      .findOne({ username })) as User;
    if (!leavingUser) return;

    const movementsToInsert: any[] = [];

    for (const sender of allSenders) {
      let senderChanged = false;

      for (const senderVillage of sender.villages) {
        if (!senderVillage.supportSent) continue;

        const toReturn = senderVillage.supportSent.filter(
          (s) => s.recipientUsername === username,
        );
        if (toReturn.length === 0) continue;

        for (const support of toReturn) {
          const recipientVillage = leavingUser.villages.find(
            (v) => v.villageName === support.recipientVillageName,
          );
          if (!recipientVillage || !recipientVillage.clanTroops) continue;

          this.subtractClanTroops(recipientVillage.clanTroops, support.troops);

          movementsToInsert.push(
            await this.createReturnMovement(
              recipientVillage,
              senderVillage,
              sender.username,
              senderVillage.villageName,
              { ...support.troops },
            ),
          );
        }

        senderVillage.supportSent = senderVillage.supportSent.filter(
          (s) => s.recipientUsername !== username,
        );
        senderChanged = true;
      }

      if (senderChanged) {
        await this.dbAccessorService
          .getCollection(USERS_COLLECTION)
          .updateOne({ username: sender.username }, { $set: sender });
      }
    }

    // Save the leaving user once with all clanTroops subtractions
    await this.dbAccessorService
      .getCollection(USERS_COLLECTION)
      .updateOne({ username }, { $set: leavingUser });

    // Bulk insert all return movements
    if (movementsToInsert.length > 0) {
      await this.dbAccessorService
        .getCollection(MOVEMENTS_COLLECTION)
        .insertMany(movementsToInsert);
    }
  }

  async getClanMembers(clanName: string): Promise<string[]> {
    const clan = (await this.dbAccessorService
      .getCollection(CLANS_COLLECTION)
      .findOne({ clanName })) as Clan;
    if (!clan) {
      throw new HttpException('Clan not found', HttpStatus.NOT_FOUND);
    }
    return clan.members;
  }

  async areUsersInSameClan(
    username1: string,
    username2: string,
  ): Promise<boolean> {
    const user1 = (await this.dbAccessorService
      .getCollection(USERS_COLLECTION)
      .findOne({ username: username1 })) as User;
    const user2 = (await this.dbAccessorService
      .getCollection(USERS_COLLECTION)
      .findOne({ username: username2 })) as User;

    if (!user1 || !user2) return false;
    if (
      !user1.clanName ||
      !user2.clanName ||
      user1.clanName === '' ||
      user2.clanName === ''
    )
      return false;

    return user1.clanName === user2.clanName;
  }

  async kickMember(
    clanName: string,
    leaderUsername: string,
    memberUsername: string,
  ): Promise<{ success: boolean }> {
    const clan = (await this.dbAccessorService
      .getCollection(CLANS_COLLECTION)
      .findOne({ clanName })) as Clan;
    if (!clan) {
      throw new HttpException('Clan not found', HttpStatus.NOT_FOUND);
    }

    if (clan.leaderUsername !== leaderUsername) {
      throw new HttpException(
        'Only the clan leader can kick members',
        HttpStatus.FORBIDDEN,
      );
    }

    if (leaderUsername === memberUsername) {
      throw new HttpException(
        'You cannot kick yourself',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!clan.members.includes(memberUsername)) {
      throw new HttpException(
        'User is not a member of this clan',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Withdraw all support troops the kicked player has sent to clan members
    await this.withdrawAllSupportTroops(memberUsername);
    // Return all support troops other clan members sent to the kicked player
    await this.returnReceivedSupportTroops(memberUsername);

    // Remove member from clan
    await this.dbAccessorService
      .getCollection(CLANS_COLLECTION)
      .updateOne({ clanName }, { $pull: { members: memberUsername } } as any);

    // Clear user's clan
    await this.dbAccessorService
      .getCollection(USERS_COLLECTION)
      .updateOne({ username: memberUsername }, { $set: { clanName: '' } });

    // Handle relics held by the kicked player
    const heldRelicIds = await this.relicsService.getRelicIdsHeldByUser(
      memberUsername,
    );
    await this.relicsService.updateHolderClanForUser(memberUsername, null);

    if (heldRelicIds.length > 0) {
      const relicNamesList = heldRelicIds
        .map((id) => RELIC_NAMES.find((r) => r.id === id)?.name ?? id)
        .join(', ');

      const relicWord = heldRelicIds.length > 1 ? 'relics' : 'relic';
      const theseRelics = heldRelicIds.length > 1
        ? 'These relics now stand unprotected'
        : 'The relic now stands unprotected';

      await this.messagesService.sendGlobalInboxMessage(
        'A Divine Relic has been forsaken!',
        `{clan:${clanName}} has expelled {player:${memberUsername}}, who carries the ${relicNamesList}. ${theseRelics}.`,
      );

      for (const member of clan.members) {
        if (member === memberUsername) continue;
        await this.messagesService.sendClanNotificationMessage(
          member,
          'A Relic Has Been Lost!',
          `{player:${memberUsername}} has been kicked from the clan, taking the ${relicNamesList} with them. Your clan no longer controls ${heldRelicIds.length > 1 ? 'these ' + relicWord : 'this ' + relicWord}.`,
        );
      }
    }

    return { success: true };
  }

  async updateClanName(
    oldClanName: string,
    newClanName: string,
    leaderUsername: string,
  ): Promise<{ success: boolean }> {
    const clan = (await this.dbAccessorService
      .getCollection(CLANS_COLLECTION)
      .findOne({ clanName: oldClanName })) as Clan;
    if (!clan) {
      throw new HttpException('Clan not found', HttpStatus.NOT_FOUND);
    }

    if (clan.leaderUsername !== leaderUsername) {
      throw new HttpException(
        'Only the clan leader can update the clan name',
        HttpStatus.FORBIDDEN,
      );
    }

    // Check if new name already exists
    const existingClan = await this.dbAccessorService
      .getCollection(CLANS_COLLECTION)
      .findOne({ clanName: newClanName });
    if (existingClan) {
      throw new HttpException('Clan name already exists', HttpStatus.CONFLICT);
    }

    // Update clan name
    await this.dbAccessorService
      .getCollection(CLANS_COLLECTION)
      .updateOne(
        { clanName: oldClanName },
        { $set: { clanName: newClanName } },
      );

    // Update all members' clanName
    await this.dbAccessorService
      .getCollection(USERS_COLLECTION)
      .updateMany(
        { clanName: oldClanName },
        { $set: { clanName: newClanName } },
      );

    // Update pending clan requests to the new name
    await this.dbAccessorService
      .getCollection(USERS_COLLECTION)
      .updateMany(
        { pendingClanRequests: oldClanName },
        { $set: { 'pendingClanRequests.$': newClanName } },
      );

    return { success: true };
  }

  async updateClanDescription(
    clanName: string,
    description: string,
    leaderUsername: string,
  ): Promise<{ success: boolean }> {
    const clan = (await this.dbAccessorService
      .getCollection(CLANS_COLLECTION)
      .findOne({ clanName })) as Clan;
    if (!clan) {
      throw new HttpException('Clan not found', HttpStatus.NOT_FOUND);
    }
    if (clan.leaderUsername !== leaderUsername) {
      throw new HttpException(
        'Only the clan leader can update the description',
        HttpStatus.FORBIDDEN,
      );
    }
    await this.dbAccessorService
      .getCollection(CLANS_COLLECTION)
      .updateOne({ clanName }, { $set: { description } });
    return { success: true };
  }

  async toggleClanOpen(
    toggleDTO: ToggleClanOpenDTO,
  ): Promise<{ success: boolean }> {
    const clan = (await this.dbAccessorService
      .getCollection(CLANS_COLLECTION)
      .findOne({ clanName: toggleDTO.clanName })) as Clan;
    if (!clan) {
      throw new HttpException('Clan not found', HttpStatus.NOT_FOUND);
    }

    if (clan.leaderUsername !== toggleDTO.leaderUsername) {
      throw new HttpException(
        'Only the clan leader can change clan settings',
        HttpStatus.FORBIDDEN,
      );
    }

    await this.dbAccessorService
      .getCollection(CLANS_COLLECTION)
      .updateOne(
        { clanName: toggleDTO.clanName },
        { $set: { isOpen: toggleDTO.isOpen } },
      );

    return { success: true };
  }
}

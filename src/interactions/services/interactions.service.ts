import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  forwardRef,
} from '@nestjs/common';
import {
  MERCHANT_SPEED,
  SKILL_TIER_COSTS,
  SkillCategory,
  SkillTier,
  Skills,
  calculateDistance,
  calculateTravelTimeMs,
  canLearnSkill,
  embassyMaximumDefenseTroopsByLevels,
  getArmySpeed,
  getResetCost,
  getSkillPointsByAcademyLevel,
  getUsedSkillPoints,
  warehouseStorageByLevel,
} from 'utils';
import { BossService } from '../../bosses/services/boss.service';
import { DbAccessorService } from '../../database/services/db-accessor.service';
import { MessagesService } from '../../messages/services/messages.service';
import { UserDTO } from '../../user/dtos/userDTO';
import { Location } from '../../user/models/location';
import { TroopsAmounts } from '../../user/models/troopsAmounts';
import { User } from '../../user/models/user.entity';
import { Village } from '../../user/models/village.entity';
import { WorldService } from '../../world/services/world.service';
import {
  CreateVillageDTO,
  LearnSkillDTO,
  ResetSkillsDTO,
  SendResourcesDTO,
  SendSupportDTO,
  WithdrawSupportDTO,
} from '../dtos/interactionDTO';

const USERS_COLLECTION = 'users';
const CENTER_BUILDING_LEVEL_FOR_NEW_VILLAGE = 10;

@Injectable()
export class InteractionsService {
  constructor(
    private dbAccessorService: DbAccessorService,
    private worldService: WorldService,
    private messagesService: MessagesService,
    @Inject(forwardRef(() => BossService)) private bossService: BossService,
  ) {}

  async sendSupport(dto: SendSupportDTO): Promise<UserDTO> {
    const sender = (await this.dbAccessorService
      .getCollection(USERS_COLLECTION)
      .findOne({ username: dto.senderUsername })) as User;
    const recipient = (await this.dbAccessorService
      .getCollection(USERS_COLLECTION)
      .findOne({ username: dto.recipientUsername })) as User;

    if (!sender || !recipient) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    // Same clan validation
    if (
      !sender.clanName ||
      !recipient.clanName ||
      sender.clanName !== recipient.clanName
    ) {
      throw new HttpException(
        'You can only send support to clan members',
        HttpStatus.BAD_REQUEST,
      );
    }

    const senderVillage = sender.villages[dto.senderVillageIndex];
    if (!senderVillage) {
      throw new HttpException('Sender village not found', HttpStatus.NOT_FOUND);
    }

    // Use case-insensitive and trimmed comparison to handle potential data sync issues
    const recipientVillageName = dto.recipientVillageName?.trim().toLowerCase();
    const recipientVillage = recipient.villages.find(
      (v) => v.villageName?.trim().toLowerCase() === recipientVillageName,
    );
    if (!recipientVillage) {
      throw new HttpException(
        'Recipient village not found',
        HttpStatus.NOT_FOUND,
      );
    }

    // Validate sender has enough troops
    if (!this.hasSufficientTroops(senderVillage.troops, dto.troops)) {
      throw new HttpException('Insufficient troops', HttpStatus.BAD_REQUEST);
    }

    // Check if any troops are being sent
    if (this.isTroopsEmpty(dto.troops)) {
      throw new HttpException(
        'You must select at least one troop to send',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Validate embassy capacity
    const embassyLevel = recipientVillage.buildingsLevels.embassyLevel || 0;
    const embassyCapacity =
      embassyMaximumDefenseTroopsByLevels[embassyLevel] || 0;
    const currentSupportTroops = this.countTotalTroops(
      recipientVillage.clanTroops,
    );
    const incomingTroops = this.countTotalTroops(dto.troops);

    if (currentSupportTroops + incomingTroops > embassyCapacity) {
      const availableSpace = Math.max(
        0,
        embassyCapacity - currentSupportTroops,
      );
      throw new HttpException(
        `Recipient's embassy can only hold ${embassyCapacity} support troops. ` +
          `Currently has ${currentSupportTroops}, space for ${availableSpace} more.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // Deduct troops from sender (troops are in transit)
    this.subtractTroops(senderVillage.troops, dto.troops);

    // Track supportSent for withdrawal
    const existingSupport = senderVillage.supportSent?.find(
      (s) =>
        s.recipientUsername === dto.recipientUsername &&
        s.recipientVillageName === dto.recipientVillageName,
    );

    if (existingSupport) {
      this.addTroops(existingSupport.troops, dto.troops);
    } else {
      if (!senderVillage.supportSent) senderVillage.supportSent = [];
      senderVillage.supportSent.push({
        recipientUsername: dto.recipientUsername,
        recipientVillageName: dto.recipientVillageName,
        troops: { ...dto.troops },
      });
    }

    // Update sender (recipient will be updated when support arrives)
    await this.dbAccessorService
      .getCollection(USERS_COLLECTION)
      .updateOne({ username: dto.senderUsername }, { $set: sender });

    // Create support movement
    const distance = calculateDistance(
      senderVillage.location.x,
      senderVillage.location.y,
      recipientVillage.location.x,
      recipientVillage.location.y,
    );
    const armySpeed = getArmySpeed(dto.troops as any);
    const quickStepBonus = 0; // Skill integration will be handled with Skill Tree
    const travelTimeMs = calculateTravelTimeMs(
      distance,
      armySpeed,
      quickStepBonus,
    );
    const departureTime = new Date();
    const arrivalTime = new Date(departureTime.getTime() + travelTimeMs);

    await this.dbAccessorService.getCollection('movements').insertOne({
      type: 'support',
      senderUsername: dto.senderUsername,
      senderVillageName: senderVillage.villageName,
      targetUsername: dto.recipientUsername,
      targetVillageName: recipientVillage.villageName,
      troops: dto.troops,
      departureTime,
      arrivalTime,
      status: 'in_transit',
    });

    // Send messages to both parties
    const troopsData = {
      spearFighters: dto.troops.spearFighters,
      swordFighters: dto.troops.swordFighters,
      axeFighters: dto.troops.axeFighters,
      archers: dto.troops.archers,
      magicians: dto.troops.magicians,
      horsemen: dto.troops.horsemen,
      catapults: dto.troops.catapults,
    };

    await this.messagesService.sendSupportTroopsMessage(
      dto.senderUsername,
      dto.recipientUsername,
      senderVillage.villageName,
      dto.recipientVillageName,
      troopsData,
      true, // sender message
    );

    await this.messagesService.sendSupportTroopsMessage(
      dto.senderUsername,
      dto.recipientUsername,
      senderVillage.villageName,
      dto.recipientVillageName,
      troopsData,
      false, // recipient message
    );

    return new UserDTO(sender);
  }

  async withdrawSupport(dto: WithdrawSupportDTO): Promise<UserDTO> {
    const owner = (await this.dbAccessorService
      .getCollection(USERS_COLLECTION)
      .findOne({ username: dto.ownerUsername })) as User;
    const recipient = (await this.dbAccessorService
      .getCollection(USERS_COLLECTION)
      .findOne({ username: dto.recipientUsername })) as User;

    if (!owner || !recipient) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    const ownerVillage = owner.villages[dto.ownerVillageIndex];
    if (!ownerVillage) {
      throw new HttpException('Owner village not found', HttpStatus.NOT_FOUND);
    }

    const recipientVillage = recipient.villages.find(
      (v) => v.villageName === dto.recipientVillageName,
    );
    if (!recipientVillage) {
      throw new HttpException(
        'Recipient village not found',
        HttpStatus.NOT_FOUND,
      );
    }

    // Find support entry
    const supportIndex = ownerVillage.supportSent?.findIndex(
      (s) =>
        s.recipientUsername === dto.recipientUsername &&
        s.recipientVillageName === dto.recipientVillageName,
    );

    if (supportIndex === undefined || supportIndex === -1) {
      throw new HttpException(
        'No support found to withdraw',
        HttpStatus.NOT_FOUND,
      );
    }

    const supportEntry = ownerVillage.supportSent[supportIndex];

    // Validate withdrawal amounts
    if (!this.hasSufficientTroops(supportEntry.troops, dto.troops)) {
      throw new HttpException(
        'Cannot withdraw more troops than sent',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Validate recipient still has these troops in clanTroops
    if (!this.hasSufficientTroops(recipientVillage.clanTroops, dto.troops)) {
      throw new HttpException(
        'Recipient no longer has these support troops',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Subtract from supportSent tracking
    this.subtractTroops(supportEntry.troops, dto.troops);

    // Remove entry if empty
    if (this.isTroopsEmpty(supportEntry.troops)) {
      ownerVillage.supportSent.splice(supportIndex, 1);
    }

    // Subtract from recipient's clanTroops
    this.subtractTroops(recipientVillage.clanTroops, dto.troops);

    // Update both users (troops removed from recipient now, owner gets them via return movement)
    await this.dbAccessorService
      .getCollection(USERS_COLLECTION)
      .updateOne({ username: dto.ownerUsername }, { $set: owner });
    await this.dbAccessorService
      .getCollection(USERS_COLLECTION)
      .updateOne({ username: dto.recipientUsername }, { $set: recipient });

    // Create return movement for withdrawn troops
    const distance = calculateDistance(
      ownerVillage.location.x,
      ownerVillage.location.y,
      recipientVillage.location.x,
      recipientVillage.location.y,
    );
    const armySpeed = getArmySpeed(dto.troops as any);
    const travelTimeMs = calculateTravelTimeMs(distance, armySpeed, 0);
    const departureTime = new Date();
    const arrivalTime = new Date(departureTime.getTime() + travelTimeMs);

    await this.dbAccessorService.getCollection('movements').insertOne({
      type: 'return',
      senderUsername: dto.ownerUsername,
      senderVillageName: ownerVillage.villageName,
      targetUsername: dto.ownerUsername,
      targetVillageName: ownerVillage.villageName,
      troops: dto.troops,
      departureTime,
      arrivalTime,
      status: 'in_transit',
    });

    // Send withdrawal message to recipient
    const troopsData = {
      spearFighters: dto.troops.spearFighters,
      swordFighters: dto.troops.swordFighters,
      axeFighters: dto.troops.axeFighters,
      archers: dto.troops.archers,
      magicians: dto.troops.magicians,
      horsemen: dto.troops.horsemen,
      catapults: dto.troops.catapults,
    };
    await this.messagesService.sendSupportWithdrawnMessage(
      dto.ownerUsername,
      dto.recipientUsername,
      ownerVillage.villageName,
      dto.recipientVillageName,
      troopsData,
    );

    return new UserDTO(owner);
  }

  async sendResources(dto: SendResourcesDTO): Promise<UserDTO> {
    const sender = (await this.dbAccessorService
      .getCollection(USERS_COLLECTION)
      .findOne({ username: dto.senderUsername })) as User;
    const recipient = (await this.dbAccessorService
      .getCollection(USERS_COLLECTION)
      .findOne({ username: dto.recipientUsername })) as User;

    if (!sender || !recipient) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    // Same clan validation
    if (
      !sender.clanName ||
      !recipient.clanName ||
      sender.clanName !== recipient.clanName
    ) {
      throw new HttpException(
        'You can only send resources to clan members',
        HttpStatus.BAD_REQUEST,
      );
    }

    const senderVillage = sender.villages[dto.senderVillageIndex];
    if (!senderVillage) {
      throw new HttpException('Sender village not found', HttpStatus.NOT_FOUND);
    }

    // Use case-insensitive and trimmed comparison
    const recipientVillageName = dto.recipientVillageName?.trim().toLowerCase();
    const recipientVillage = recipient.villages.find(
      (v) => v.villageName?.trim().toLowerCase() === recipientVillageName,
    );
    if (!recipientVillage) {
      throw new HttpException(
        'Recipient village not found',
        HttpStatus.NOT_FOUND,
      );
    }

    // Validate non-negative amounts (prevent stealing via negative values)
    if (
      dto.resources.woodAmount < 0 ||
      dto.resources.stonesAmount < 0 ||
      dto.resources.cropAmount < 0
    ) {
      throw new HttpException(
        'Resource amounts cannot be negative',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Check if anything is being sent
    if (
      dto.resources.woodAmount === 0 &&
      dto.resources.stonesAmount === 0 &&
      dto.resources.cropAmount === 0
    ) {
      throw new HttpException(
        'You must send at least some resources',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Cap requested amounts to what sender actually has
    const woodToSend = Math.min(
      dto.resources.woodAmount,
      senderVillage.resourcesAmounts.woodAmount,
    );
    const stoneToSend = Math.min(
      dto.resources.stonesAmount,
      senderVillage.resourcesAmounts.stonesAmount,
    );
    const cropToSend = Math.min(
      dto.resources.cropAmount,
      senderVillage.resourcesAmounts.cropAmount,
    );

    // Calculate recipient's available space
    const maxWood =
      warehouseStorageByLevel[
        recipientVillage.buildingsLevels.woodWarehouseLevel
      ];
    const maxStone =
      warehouseStorageByLevel[
        recipientVillage.buildingsLevels.stoneWarehouseLevel
      ];
    const maxCrop =
      warehouseStorageByLevel[
        recipientVillage.buildingsLevels.cropWarehouseLevel
      ];

    const woodSpace = Math.max(
      0,
      maxWood - recipientVillage.resourcesAmounts.woodAmount,
    );
    const stoneSpace = Math.max(
      0,
      maxStone - recipientVillage.resourcesAmounts.stonesAmount,
    );
    const cropSpace = Math.max(
      0,
      maxCrop - recipientVillage.resourcesAmounts.cropAmount,
    );

    // Calculate actual transfer amounts (min of what sender wants to send and recipient can receive)
    const actualWood = Math.min(woodToSend, woodSpace);
    const actualStone = Math.min(stoneToSend, stoneSpace);
    const actualCrop = Math.min(cropToSend, cropSpace);

    // If nothing can be transferred at all, reject
    if (actualWood === 0 && actualStone === 0 && actualCrop === 0) {
      throw new HttpException(
        'Recipient has no storage space available for any resources',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Transfer resources from sender now (recipient receives on arrival)
    senderVillage.resourcesAmounts.woodAmount -= actualWood;
    senderVillage.resourcesAmounts.stonesAmount -= actualStone;
    senderVillage.resourcesAmounts.cropAmount -= actualCrop;

    await this.dbAccessorService
      .getCollection(USERS_COLLECTION)
      .updateOne({ username: dto.senderUsername }, { $set: sender });

    // Create resources movement
    const distance = calculateDistance(
      senderVillage.location.x,
      senderVillage.location.y,
      recipientVillage.location.x,
      recipientVillage.location.y,
    );
    const speed = MERCHANT_SPEED;
    const travelTimeMs = calculateTravelTimeMs(distance, speed, 0);
    const departureTime = new Date();
    const arrivalTime = new Date(departureTime.getTime() + travelTimeMs);

    await this.dbAccessorService.getCollection('movements').insertOne({
      type: 'resources',
      senderUsername: dto.senderUsername,
      senderVillageName: senderVillage.villageName,
      targetUsername: dto.recipientUsername,
      targetVillageName: recipientVillage.villageName,
      resources: {
        woodAmount: actualWood,
        stonesAmount: actualStone,
        cropAmount: actualCrop,
      },
      departureTime,
      arrivalTime,
      status: 'in_transit',
    });

    // Send messages to both parties with ACTUAL amounts transferred
    const resourcesData = {
      wood: actualWood,
      stone: actualStone,
      crop: actualCrop,
    };

    // Only sender message now; recipient message is sent when resources arrive (in MovementService.resolveResourcesMovement)
    await this.messagesService.sendResourceTransferMessage(
      dto.senderUsername,
      dto.recipientUsername,
      senderVillage.villageName,
      dto.recipientVillageName,
      resourcesData,
      true, // sender message
    );

    return new UserDTO(sender);
  }

  async createNewVillage(dto: CreateVillageDTO): Promise<UserDTO> {
    const MAX_VILLAGE_NAME_LENGTH = 20;

    const user = (await this.dbAccessorService
      .getCollection(USERS_COLLECTION)
      .findOne({ username: dto.username })) as User;

    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    // Validate village name length
    if (!dto.newVillageName || dto.newVillageName.trim().length === 0) {
      throw new HttpException(
        'Village name cannot be empty',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (dto.newVillageName.length > MAX_VILLAGE_NAME_LENGTH) {
      throw new HttpException(
        `Village name cannot exceed ${MAX_VILLAGE_NAME_LENGTH} characters`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const sourceVillage = user.villages[dto.sourceVillageIndex];
    if (!sourceVillage) {
      throw new HttpException('Source village not found', HttpStatus.NOT_FOUND);
    }

    // Validate center building level
    if (
      sourceVillage.buildingsLevels.centerBuildingLevel <
      CENTER_BUILDING_LEVEL_FOR_NEW_VILLAGE
    ) {
      throw new HttpException(
        `Center building must be level ${CENTER_BUILDING_LEVEL_FOR_NEW_VILLAGE} to create a new village`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // Check if user has already created a village from this source
    // Each level 10 village can only create one new village
    // Village at index N can create village at index N+1
    if (dto.sourceVillageIndex < user.villages.length - 1) {
      throw new HttpException(
        'This village has already been used to create a new village',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Validate location is within 3x3 (1 cell distance) from source village
    const sourceLocation = sourceVillage.location;
    if (!sourceLocation) {
      throw new HttpException(
        'Source village has no location',
        HttpStatus.BAD_REQUEST,
      );
    }

    const dx = Math.abs(dto.x - sourceLocation.x);
    const dy = Math.abs(dto.y - sourceLocation.y);

    if (dx > 1 || dy > 1 || (dx === 0 && dy === 0)) {
      throw new HttpException(
        'New village must be placed within 1 cell of your source village (3x3 grid)',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Validate village name is unique for this user
    if (user.villages.some((v) => v.villageName === dto.newVillageName)) {
      throw new HttpException(
        'Village name already exists',
        HttpStatus.CONFLICT,
      );
    }

    // Check if a boss is occupying this cell
    const hasBoss = await this.bossService.isCellOccupiedByBoss(dto.x, dto.y);
    if (hasBoss) {
      throw new HttpException(
        'Cannot create village on a cell occupied by a raid boss',
        HttpStatus.CONFLICT,
      );
    }

    // Reserve the grid cell
    const reserved = await this.worldService.reserveGridForVillage(
      dto.x,
      dto.y,
      dto.username,
      dto.newVillageName,
    );

    if (!reserved) {
      throw new HttpException(
        'Grid cell is not available',
        HttpStatus.CONFLICT,
      );
    }

    // Create new village
    const newVillage = new Village(
      dto.newVillageName,
      new Location(dto.x, dto.y),
    );
    user.villages.push(newVillage);

    // Update user
    await this.dbAccessorService
      .getCollection(USERS_COLLECTION)
      .updateOne({ username: dto.username }, { $set: user });

    return new UserDTO(user);
  }

  async renameVillage(dto: {
    username: string;
    villageIndex: number;
    newVillageName: string;
  }): Promise<UserDTO> {
    const MAX_VILLAGE_NAME_LENGTH = 20;

    const user = (await this.dbAccessorService
      .getCollection(USERS_COLLECTION)
      .findOne({ username: dto.username })) as User;
    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    const village = user.villages[dto.villageIndex];
    if (!village) {
      throw new HttpException('Village not found', HttpStatus.NOT_FOUND);
    }

    if (!dto.newVillageName || dto.newVillageName.trim().length === 0) {
      throw new HttpException(
        'Village name cannot be empty',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (dto.newVillageName.length > MAX_VILLAGE_NAME_LENGTH) {
      throw new HttpException(
        `Village name cannot exceed ${MAX_VILLAGE_NAME_LENGTH} characters`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // Check if name is unique for this user (excluding current village)
    const isDuplicate = user.villages.some(
      (v, i) =>
        i !== dto.villageIndex && v.villageName === dto.newVillageName.trim(),
    );
    if (isDuplicate) {
      throw new HttpException(
        'You already have a village with this name',
        HttpStatus.CONFLICT,
      );
    }

    const oldName = village.villageName;
    village.villageName = dto.newVillageName.trim();

    // Update user
    await this.dbAccessorService
      .getCollection(USERS_COLLECTION)
      .updateOne({ username: dto.username }, { $set: user });

    // Update grid cell with new village name
    if (village.location) {
      await this.worldService.updateVillageName(
        village.location.x,
        village.location.y,
        dto.newVillageName.trim(),
      );
    }

    // Update all supportSent entries in other users that reference this village
    // This ensures support troop withdrawal still works after village rename
    await this.dbAccessorService.getCollection(USERS_COLLECTION).updateMany(
      {
        'villages.supportSent.recipientUsername': dto.username,
        'villages.supportSent.recipientVillageName': oldName,
      },
      {
        $set: {
          'villages.$[].supportSent.$[elem].recipientVillageName':
            dto.newVillageName.trim(),
        },
      },
      {
        arrayFilters: [
          {
            'elem.recipientUsername': dto.username,
            'elem.recipientVillageName': oldName,
          },
        ],
      },
    );

    return new UserDTO(user);
  }

  async learnSkill(dto: LearnSkillDTO): Promise<UserDTO> {
    const user = (await this.dbAccessorService
      .getCollection(USERS_COLLECTION)
      .findOne({ username: dto.username })) as User;

    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    const village = user.villages[dto.villageIndex];
    if (!village) {
      throw new HttpException('Village not found', HttpStatus.NOT_FOUND);
    }

    const academyLevel = village.buildingsLevels.academyLevel || 1;

    const category = dto.category as SkillCategory;
    const tier = dto.tier as SkillTier;

    if (!Object.values(SkillCategory).includes(category)) {
      throw new HttpException('Invalid skill category', HttpStatus.BAD_REQUEST);
    }
    if (!Object.values(SkillTier).includes(tier)) {
      throw new HttpException('Invalid skill tier', HttpStatus.BAD_REQUEST);
    }

    const canLearn = canLearnSkill(
      academyLevel,
      village.skills as Skills,
      category,
      tier,
    );
    if (!canLearn) {
      throw new HttpException(
        'Cannot learn this skill (missing prerequisites or points)',
        HttpStatus.BAD_REQUEST,
      );
    }

    const totalPoints = getSkillPointsByAcademyLevel(academyLevel);
    const usedPoints = getUsedSkillPoints(village.skills as Skills);
    const cost = SKILL_TIER_COSTS[tier];

    if (usedPoints + cost > totalPoints) {
      throw new HttpException(
        'Not enough skill points',
        HttpStatus.BAD_REQUEST,
      );
    }

    const villagePath = `villages.${dto.villageIndex}.skills.${category}`;

    await this.dbAccessorService
      .getCollection(USERS_COLLECTION)
      .updateOne({ username: dto.username }, { $set: { [villagePath]: tier } });

    village.skills[category] = tier;

    return new UserDTO(user);
  }

  async resetSkills(dto: ResetSkillsDTO): Promise<UserDTO> {
    const user = (await this.dbAccessorService
      .getCollection(USERS_COLLECTION)
      .findOne({ username: dto.username })) as User;

    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    const village = user.villages[dto.villageIndex];
    if (!village) {
      throw new HttpException('Village not found', HttpStatus.NOT_FOUND);
    }

    const academyLevel = village.buildingsLevels.academyLevel || 1;
    const usedPoints = getUsedSkillPoints(village.skills as Skills);

    if (usedPoints <= 0) {
      return new UserDTO(user);
    }

    const cost = getResetCost(usedPoints);

    if (
      village.resourcesAmounts.woodAmount < cost.wood ||
      village.resourcesAmounts.stonesAmount < cost.stones ||
      village.resourcesAmounts.cropAmount < cost.crop
    ) {
      throw new HttpException(
        'Not enough resources to reset skills',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Deduct resources
    village.resourcesAmounts.woodAmount -= cost.wood;
    village.resourcesAmounts.stonesAmount -= cost.stones;
    village.resourcesAmounts.cropAmount -= cost.crop;

    // Reset all skills to null
    const clearedSkills: Skills = {} as Skills;
    for (const key of Object.keys(village.skills) as Array<keyof Skills>) {
      clearedSkills[key] = null;
    }
    village.skills = clearedSkills;

    await this.dbAccessorService.getCollection(USERS_COLLECTION).updateOne(
      { username: dto.username },
      {
        $set: {
          [`villages.${dto.villageIndex}.skills`]: clearedSkills,
          [`villages.${dto.villageIndex}.resourcesAmounts.woodAmount`]:
            village.resourcesAmounts.woodAmount,
          [`villages.${dto.villageIndex}.resourcesAmounts.stonesAmount`]:
            village.resourcesAmounts.stonesAmount,
          [`villages.${dto.villageIndex}.resourcesAmounts.cropAmount`]:
            village.resourcesAmounts.cropAmount,
        },
      },
    );

    return new UserDTO(user);
  }

  private hasSufficientTroops(
    available: TroopsAmounts,
    required: TroopsAmounts,
  ): boolean {
    return (
      available.spearFighters >= required.spearFighters &&
      available.swordFighters >= required.swordFighters &&
      available.axeFighters >= required.axeFighters &&
      available.archers >= required.archers &&
      available.magicians >= required.magicians &&
      available.horsemen >= required.horsemen &&
      available.catapults >= required.catapults
    );
  }

  private subtractTroops(from: TroopsAmounts, amount: TroopsAmounts): void {
    from.spearFighters -= amount.spearFighters;
    from.swordFighters -= amount.swordFighters;
    from.axeFighters -= amount.axeFighters;
    from.archers -= amount.archers;
    from.magicians -= amount.magicians;
    from.horsemen -= amount.horsemen;
    from.catapults -= amount.catapults;
  }

  private addTroops(to: TroopsAmounts, amount: TroopsAmounts): void {
    to.spearFighters += amount.spearFighters;
    to.swordFighters += amount.swordFighters;
    to.axeFighters += amount.axeFighters;
    to.archers += amount.archers;
    to.magicians += amount.magicians;
    to.horsemen += amount.horsemen;
    to.catapults += amount.catapults;
  }

  private isTroopsEmpty(troops: TroopsAmounts): boolean {
    return (
      troops.spearFighters === 0 &&
      troops.swordFighters === 0 &&
      troops.axeFighters === 0 &&
      troops.archers === 0 &&
      troops.magicians === 0 &&
      troops.horsemen === 0 &&
      troops.catapults === 0
    );
  }

  private countTotalTroops(troops: TroopsAmounts): number {
    return (
      (troops.spearFighters || 0) +
      (troops.swordFighters || 0) +
      (troops.axeFighters || 0) +
      (troops.archers || 0) +
      (troops.magicians || 0) +
      (troops.horsemen || 0) +
      (troops.catapults || 0)
    );
  }
}

import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { DbAccessorService } from '../../../database/services/db-accessor.service';
import { User } from '../../../user/models/user.entity';
import { upgradeDTO } from '../../dtos/upgradeDTO';
import { buildingLevelUpMaterialCostsByName, MaterialsCost, quartersPopulationByLevel } from 'utils';
import { ResourcesAmounts } from '../../../user/models/resourcesAmounts';
import { Village } from '../../../user/models/village.entity';
import { UpdateResult } from 'mongodb';
import { BuildingGetterSetter } from '../../classes/buildingGetterSetter';
import { UserDTO } from '../../../user/dtos/userDTO';

@Injectable()
export class BuildingsUpgradingService {
    constructor(private dbAccessorService: DbAccessorService)
    {

    }

    async upgradeBuilding(upgradeDTO: upgradeDTO): Promise<UserDTO>{
        const user: User = (await this.dbAccessorService.collection.findOne({username: upgradeDTO.username})) as User;
        if(!user)
            throw new HttpException("Username doesnt exist", HttpStatus.NOT_FOUND);
        const village: Village = user.villages[upgradeDTO.villageIndex];
        if(!village)
            throw new HttpException("Village doesnt exist", HttpStatus.NOT_FOUND);

        const buildingLevelUpMaterialCostsByLevel: Array<MaterialsCost> =  buildingLevelUpMaterialCostsByName[upgradeDTO.buildingName]
        if(!buildingLevelUpMaterialCostsByLevel)
            throw new HttpException("Building name doesnt exist", HttpStatus.NOT_FOUND);
        const buildingsLevelsDictionary: {[name: string] : BuildingGetterSetter } = this.buildUserBuildingsLevelsDictionary(village);
        const buildingNextLevel: number = buildingsLevelsDictionary[upgradeDTO.buildingName].getter() + 1;
        const materialsCost: MaterialsCost = buildingLevelUpMaterialCostsByLevel[buildingNextLevel];
        if(!this.doesUserHaveEnoughMaterialsForLevelUp(village.resourcesAmounts, materialsCost))
            throw new HttpException("Village does not have enough materials for this upgrade", HttpStatus.FORBIDDEN);

        // everything good -> level up his building and decrease resources

        buildingsLevelsDictionary[upgradeDTO.buildingName].setter(buildingsLevelsDictionary[upgradeDTO.buildingName].getter() + 1)

        village.resourcesAmounts.cropAmount -= materialsCost.crop;
        village.resourcesAmounts.stonesAmount -= materialsCost.stones;
        village.resourcesAmounts.woodAmount -= materialsCost.wood;

        const updateResult: UpdateResult = await this.dbAccessorService.collection.updateOne({username: upgradeDTO.username}, {$set: user});
        return new UserDTO(user);
    }

    buildUserBuildingsLevelsDictionary(userVillage: Village): {[name: string] : BuildingGetterSetter}
    {
        const userBuildingsLevelsDictionary: {[name: string] : BuildingGetterSetter } = {
            ["arsenal"]: {getter: () => {return userVillage.buildingsLevels.arsenalLevel }, setter: (newLevel) => {userVillage.buildingsLevels.arsenalLevel = newLevel}},
            ["centerBuilding"]: {getter: () => {return userVillage.buildingsLevels.centerBuildingLevel }, setter: (newLevel) => {userVillage.buildingsLevels.centerBuildingLevel = newLevel}},
            ["cropFarm"]: {getter: () => {return userVillage.buildingsLevels.cropFarmLevel }, setter: (newLevel) => {userVillage.buildingsLevels.cropFarmLevel = newLevel}},
            ["cropWarehouse"]: {getter: () => {return userVillage.buildingsLevels.cropWarehouseLevel }, setter: (newLevel) => {userVillage.buildingsLevels.cropWarehouseLevel = newLevel}},
            ["embassy"]: {getter: () => {return userVillage.buildingsLevels.embassyLevel }, setter: (newLevel) => {userVillage.buildingsLevels.embassyLevel = newLevel}},
            ["quarters"]: {getter: () => {return userVillage.buildingsLevels.quartersLevel }, setter: (newLevel) => {
                userVillage.buildingsLevels.quartersLevel = newLevel
                userVillage.population = quartersPopulationByLevel[newLevel];
            }},
            ["stoneMine"]: {getter: () => {return userVillage.buildingsLevels.stoneMineLevel }, setter: (newLevel) => {userVillage.buildingsLevels.stoneMineLevel = newLevel}},
            ["stoneWarehouse"]: {getter: () => {return userVillage.buildingsLevels.stoneWarehouseLevel }, setter: (newLevel) => {userVillage.buildingsLevels.stoneWarehouseLevel = newLevel}},
            ["wall"]: {getter: () => {return userVillage.buildingsLevels.wallLevel }, setter: (newLevel) => {userVillage.buildingsLevels.wallLevel = newLevel}},
            ["woodFactory"]: {getter: () => {return userVillage.buildingsLevels.woodFactoryLevel }, setter: (newLevel) => {userVillage.buildingsLevels.woodFactoryLevel = newLevel}},
            ["woodWarehouse"]: {getter: () => {return userVillage.buildingsLevels.woodWarehouseLevel }, setter: (newLevel) => {userVillage.buildingsLevels.woodWarehouseLevel = newLevel}},
        };
        return userBuildingsLevelsDictionary;
    }

    doesUserHaveEnoughMaterialsForLevelUp(userMaterials: ResourcesAmounts, materialsCost: MaterialsCost): boolean
    {
        if(userMaterials.cropAmount < materialsCost.crop)
            return false;
        if(userMaterials.stonesAmount < materialsCost.stones)
            return false;
        if(userMaterials.woodAmount < materialsCost.wood)
            return false;
        return true;
    }
}

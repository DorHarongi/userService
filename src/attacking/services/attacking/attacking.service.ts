import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { AttackDTO } from '../../dtos/attackDTO';
import { TroopsAmounts } from '../../../user/models/troopsAmounts';
import { wallDefenseByLevel, spearFighterDefenceStat, swordFighterDefenceStat, axeFighterDefenceStat,
    archerDefenceStat, magicianDefenceStat, horsemenDefenceStat, catapultsDefenceStat,
    spearFighterAttackingStat, swordFighterAttackingStat, axeFighterAttackingStat, archerAttackingStat,
    magicianAttackingStat, horsemenAttackingStat, catapultsAttackingStat, lootingAbilityOfTroops,
    warehouseStorageByLevel} from 'utils';
import { DbAccessorService } from '../../../database/services/db-accessor.service';
import { User } from '../../../user/models/user.entity';
import { Village } from '../../../user/models/village.entity';
import { ResourcesAmounts } from '../../../user/models/resourcesAmounts';
import { UpdateResult } from 'mongodb';
import { UserDTO } from '../../../user/dtos/userDTO';
import { AttackReport } from '../../../reports/models/attackReport.entity';
import { ReportsService } from '../../../reports/services/reports/reports.service';

const USER_COLLECTIONS = "users";

@Injectable()
export class AttackingService {

    constructor(private dbAccessorService: DbAccessorService, private reportsService: ReportsService){

    }

    async attack(attackDTO: AttackDTO): Promise<any>{
        if(attackDTO.attackerName == attackDTO.defenderName)
            throw new HttpException("You cant attack yourself", HttpStatus.BAD_REQUEST) 
        let attacker: User = (await this.dbAccessorService.getCollection(USER_COLLECTIONS).findOne({username: attackDTO.attackerName})) as User;
        let defender: User = (await this.dbAccessorService.getCollection(USER_COLLECTIONS).findOne({username: attackDTO.defenderName})) as User;
        if(!attacker || !defender)
            throw new HttpException("Attacker or defender doesnt exist", HttpStatus.NOT_FOUND);
        const attackerVillage: Village = attacker.villages[attackDTO.attackerVillageIndex];
        const defenderVillage: Village = defender.villages[attackDTO.defenderVillageIndex];
        if(!attackerVillage || !defenderVillage)
            throw new HttpException("Attacker or defender village doesnt exist", HttpStatus.NOT_FOUND) 

        if(!this.doesAttackerActuallyHaveThoseTroops(attackDTO.attackingTroops, attackerVillage.troops))
            throw new HttpException("You chose more troops than you have", HttpStatus.BAD_REQUEST) 

        if(!this.doesAttackerHaveEnoughEnergy(attacker.energy))
            throw new HttpException("You have no energy.", HttpStatus.BAD_REQUEST)


        // everything good -> attack
        let attackerTroops: TroopsAmounts = attackDTO.attackingTroops;
        let defenceTroops: TroopsAmounts = defenderVillage.troops;
        let supportTroops: TroopsAmounts = defenderVillage.clanTroops;
        let wallLevel: number = defenderVillage.buildingsLevels.wallLevel;
        let attackingPower: number = this.calculateAttackingPower(attackDTO.attackingTroops);
        let villageDefence: number = this.calculateVillageDefence(defenceTroops, supportTroops, wallLevel);
        let attackToDefenceRatio: number = attackingPower / villageDefence;
        let defenceToAttackRatio: number = villageDefence / attackingPower;

        let killedAttackerTroops: TroopsAmounts;
        let killedDefenderTroops: TroopsAmounts;
        let killedSupportTroops: TroopsAmounts;

        let attackWon: boolean;

        if(attackToDefenceRatio <= 1) // LOSE
        {
            attackWon = false;
            killedAttackerTroops = this.calculateKilledTroopsByRatio(attackerTroops, 1); // kill all attackers
            killedDefenderTroops = this.calculateKilledTroopsByRatio(defenceTroops, attackToDefenceRatio); // kill some of the defence
            killedSupportTroops = this.calculateKilledTroopsByRatio(supportTroops, attackToDefenceRatio); // kill some of the clan defence
        }
        else // WIN
        {
            attackWon = true;
            killedDefenderTroops = this.calculateKilledTroopsByRatio(defenceTroops, 1); // kill all defence
            killedSupportTroops = this.calculateKilledTroopsByRatio(supportTroops, 1); // kill all clan defence
            killedAttackerTroops = this.calculateKilledTroopsByRatio(attackerTroops, defenceToAttackRatio); // kill some of attacker troops
        }

        // loot resources - increase to attacker, decrease to defender
        let loot = new ResourcesAmounts(0, 0, 0);
        if(attackWon)
        {
            loot = this.calculateLoot(attackerTroops, defenderVillage.resourcesAmounts);
            this.addLootToAttacker(loot, attackerVillage);
            this.decreaseLootFromDefender(loot, defenderVillage);
        }

        const attackReport = new AttackReport(attackDTO.attackerName, attackerVillage.villageName, attackDTO.defenderName,
            defenderVillage.villageName, new Date(), attackWon, loot, attackingPower, villageDefence, 
            this.calculateTroopsDefence(defenceTroops), this.calculateAttackingPower(supportTroops),
            wallDefenseByLevel[wallLevel], attackerTroops, killedAttackerTroops,
            defenceTroops, killedDefenderTroops, supportTroops, killedSupportTroops);
            
        await this.reportsService.saveAttackReport(attackReport);

        this.updateRemainingTroopsInVillage(attackerVillage.troops, killedAttackerTroops);
        this.updateRemainingTroopsInVillage(defenceTroops, killedDefenderTroops);
        this.updateRemainingTroopsInVillage(supportTroops, killedSupportTroops);
        this.decreaseEnergy(attacker);

        //update attacker village
        const attackerUpdateResult: UpdateResult = await this.dbAccessorService.getCollection(USER_COLLECTIONS).updateOne({username: attackDTO.attackerName}, {$set: attacker});
        //update villager village
        const DefenderUpdateResult: UpdateResult = await this.dbAccessorService.getCollection(USER_COLLECTIONS).updateOne({username: attackDTO.defenderName}, {$set: defender});

        return new UserDTO(attacker);
    }

    doesAttackerActuallyHaveThoseTroops(attackingTroops: TroopsAmounts, existingAttackerTroops: TroopsAmounts): boolean
    {
        if(existingAttackerTroops.spearFighters < attackingTroops.spearFighters)
            return false;
        if(existingAttackerTroops.swordFighters < attackingTroops.swordFighters)
            return false;
        if(existingAttackerTroops.axeFighters < attackingTroops.axeFighters)
            return false;
        if(existingAttackerTroops.archers < attackingTroops.archers)
            return false;
        if(existingAttackerTroops.magicians < attackingTroops.magicians)
            return false;
        if(existingAttackerTroops.horsemen < attackingTroops.horsemen)
            return false;
        if(existingAttackerTroops.catapults < attackingTroops.catapults)
            return false;
        
        return true;

    }

    doesAttackerHaveEnoughEnergy(energy: number): boolean{
        return energy > 1;
    }

    decreaseEnergy(attacker: User)
    {
        attacker.energy -= 1;
    }

    calculateAttackingPower(attackingTroops: TroopsAmounts): number
    {
        return attackingTroops.spearFighters * spearFighterAttackingStat +
        attackingTroops.swordFighters * swordFighterAttackingStat +
        attackingTroops.axeFighters * axeFighterAttackingStat +
        attackingTroops.archers * archerAttackingStat +
        attackingTroops.magicians * magicianAttackingStat +
        attackingTroops.horsemen * horsemenAttackingStat +
        attackingTroops.catapults * catapultsAttackingStat;
    }

    calculateTroopsDefence(troops: TroopsAmounts): number
    {
        return troops.spearFighters * spearFighterDefenceStat +
        troops.swordFighters * swordFighterDefenceStat +
        troops.axeFighters * axeFighterDefenceStat +
        troops.archers * archerDefenceStat +
        troops.magicians * magicianDefenceStat +
        troops.horsemen * horsemenDefenceStat +
        troops.catapults * catapultsDefenceStat;
    }

    calculateVillageDefence(defenceTroops: TroopsAmounts, supportTroops: TroopsAmounts, wallLevel: number): number
    {
        return this.calculateTroopsDefence(defenceTroops) + this.calculateTroopsDefence(supportTroops) + wallDefenseByLevel[wallLevel];
    }

    calculateKilledTroopsByRatio(troops: TroopsAmounts, ratio: number): TroopsAmounts 
    // receives 0 < ratio <= 1. Received 0.7 -> kill 70% of those troops
    {
        if(ratio > 1 || ratio < 0)
            return;

        let killedTroops: TroopsAmounts = new TroopsAmounts(0, 0, 0, 0, 0, 0, 0);
        killedTroops.spearFighters = Math.floor(ratio * troops.spearFighters); 
        killedTroops.swordFighters = Math.floor(ratio * troops.swordFighters);
        killedTroops.axeFighters = Math.floor(ratio * troops.axeFighters);
        killedTroops.archers = Math.floor(ratio * troops.archers);
        killedTroops.magicians = Math.floor(ratio * troops.magicians);
        killedTroops.horsemen = Math.floor(ratio * troops.horsemen);
        killedTroops.catapults = Math.floor(ratio * troops.catapults);

        return killedTroops;
    }

    updateRemainingTroopsInVillage(villageTroops:TroopsAmounts, killedTroops: TroopsAmounts)
    {
        villageTroops.spearFighters -= killedTroops.spearFighters;
        villageTroops.swordFighters -= killedTroops.swordFighters;
        villageTroops.axeFighters -= killedTroops.axeFighters;
        villageTroops.archers -= killedTroops.archers;
        villageTroops.magicians -= killedTroops.magicians;
        villageTroops.horsemen -= killedTroops.horsemen;
        villageTroops.catapults -= killedTroops.catapults;
    }

    addLootToAttacker(loot: ResourcesAmounts, attackerVillage: Village)
    {
        let maximumWoodCapacity = warehouseStorageByLevel[attackerVillage.buildingsLevels.woodWarehouseLevel];
        let maximumCropCapacity = warehouseStorageByLevel[attackerVillage.buildingsLevels.cropWarehouseLevel];
        let maximumStoneCapacity = warehouseStorageByLevel[attackerVillage.buildingsLevels.stoneWarehouseLevel];
        
        attackerVillage.resourcesAmounts.woodAmount += loot.woodAmount;
        attackerVillage.resourcesAmounts.cropAmount += loot.cropAmount;
        attackerVillage.resourcesAmounts.stonesAmount += loot.stonesAmount;

        attackerVillage.resourcesAmounts.woodAmount = Math.min(attackerVillage.resourcesAmounts.woodAmount, maximumWoodCapacity);
        attackerVillage.resourcesAmounts.cropAmount = Math.min(attackerVillage.resourcesAmounts.cropAmount, maximumCropCapacity);
        attackerVillage.resourcesAmounts.stonesAmount = Math.min(attackerVillage.resourcesAmounts.stonesAmount, maximumStoneCapacity);
    }

    decreaseLootFromDefender(loot: ResourcesAmounts, defenderVillage: Village)
    {
        defenderVillage.resourcesAmounts.woodAmount -= loot.woodAmount;
        defenderVillage.resourcesAmounts.cropAmount -= loot.cropAmount;
        defenderVillage.resourcesAmounts.stonesAmount -= loot.stonesAmount;
    }

    calculateLoot(remainingAttackerTroops: TroopsAmounts, defenderResources: ResourcesAmounts): ResourcesAmounts
    {
        let totalPossibleLootFromEachResource: number = this.calculateTotalPossibleLootFromEachResource(remainingAttackerTroops);
        let lootedWood: number = Math.min(totalPossibleLootFromEachResource, defenderResources.woodAmount);
        let lootedStones: number = Math.min(totalPossibleLootFromEachResource, defenderResources.stonesAmount);
        let lootedCrop: number = Math.min(totalPossibleLootFromEachResource, defenderResources.cropAmount);
        return new ResourcesAmounts(lootedWood, lootedStones, lootedCrop);
    }

    calculateTotalPossibleLootFromEachResource(attackerTroops: TroopsAmounts): number
    {
        let totalRemainingTroops = 
        attackerTroops.spearFighters +
        attackerTroops.swordFighters +
        attackerTroops.axeFighters +
        attackerTroops.archers +
        attackerTroops.magicians +
        attackerTroops.horsemen +
        attackerTroops.catapults;

        return totalRemainingTroops * lootingAbilityOfTroops;
    }

}

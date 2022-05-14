export class BuildingsLevels
{
    constructor(public centerBuildingLevel: number,
        public woodWarehouseLevel: number,
        public woodFactoryLevel: number,
        public stoneWarehouseLevel: number,
        public stoneMineLevel: number,
        public cropFarmLevel: number,
        public cropWarehouseLevel: number,
        public arsenalLevel: number,
        public quartersLevel: number,
        public wallLevel: number,
        public embassyLevel: number)
        {
            this.centerBuildingLevel = centerBuildingLevel;
            this.woodWarehouseLevel = woodWarehouseLevel;
            this.woodFactoryLevel = woodFactoryLevel;
            this.stoneWarehouseLevel = stoneWarehouseLevel;
            this.stoneMineLevel = stoneMineLevel;
            this.cropFarmLevel = cropFarmLevel;
            this.cropWarehouseLevel = cropWarehouseLevel;
            this.arsenalLevel = arsenalLevel;
            this.quartersLevel = quartersLevel;
            this.wallLevel = wallLevel;
            this.embassyLevel = embassyLevel;
        }

}
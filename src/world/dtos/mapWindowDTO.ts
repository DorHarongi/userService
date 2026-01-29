export interface MapWindowRequestDTO {
    startX: number;
    startY: number;
}

export interface VillageOnMapDTO {
    x: number;
    y: number;
    ownerUsername: string;
    villageName: string;
}

export interface MapWindowResponseDTO {
    villages: VillageOnMapDTO[];
    worldSize: number;
}

export interface MinimapResponseDTO {
    villages: VillageOnMapDTO[];
    worldSize: number;
}

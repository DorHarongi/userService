import { ObjectId } from "mongodb";

export interface IGrid {
    _id?: ObjectId;
    x: number;
    y: number;
    taken: boolean;
    ownerUsername?: string;
    villageName?: string;
}

export class Grid implements IGrid {
    _id?: ObjectId;
    x: number;
    y: number;
    taken: boolean;
    ownerUsername?: string;
    villageName?: string;

    constructor(x: number, y: number, taken: boolean = false, ownerUsername?: string, villageName?: string) {
        this.x = x;
        this.y = y;
        this.taken = taken;
        this.ownerUsername = ownerUsername;
        this.villageName = villageName;
    }
}

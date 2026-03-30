export class TroopsAmounts
{
    public spies: number;

    constructor(public spearFighters: number, public swordFighters: number, public axeFighters: number, public archers: number, public magicians: number,
                public horsemen: number, public catapults: number, spies: number = 0){
        this.spearFighters = spearFighters;
        this.swordFighters = swordFighters;
        this.axeFighters = axeFighters;
        this.archers = archers;
        this.magicians = magicians;
        this.horsemen = horsemen;
        this.catapults = catapults;
        this.spies = spies;
    }
}
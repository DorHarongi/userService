const RELICS_COLLECTION = 'relics';

export async function getVillageRelicIds(
  dbAccessor: { getCollection: (name: string) => any },
  username: string,
  villageName: string,
): Promise<string[]> {
  const docs = await dbAccessor
    .getCollection(RELICS_COLLECTION)
    .find({ holderUsername: username, holderVillageName: villageName })
    .toArray();
  return docs.map((d: any) => d.relicId as string);
}

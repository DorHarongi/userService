import type { WithId, Document } from 'mongodb'

export interface IUser extends WithId<Document> {}

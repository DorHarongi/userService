import { UserDTO } from '../user/dtos/userDTO';
import { QuestCompletionResult } from 'utils';

/**
 * Response DTO that includes user data and optional quest completion info
 */
export interface QuestAwareResponse {
    user: UserDTO;
    questCompleted?: QuestCompletionResult | null;
}

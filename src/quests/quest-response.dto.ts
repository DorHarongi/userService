import { UserDTO } from '../user/dtos/userDTO';
import { QuestCompletionResult } from 'utils';

/**
 * Response DTO that includes user data and quest claimable status
 * Rewards are never auto-claimed - user must manually claim them
 */
export interface QuestAwareResponse {
    user: UserDTO;
    isQuestClaimable?: boolean;
    // Only set after manual claim via /quests/claim endpoint
    questCompleted?: QuestCompletionResult | null;
}

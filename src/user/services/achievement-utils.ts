import { ACHIEVEMENTS } from 'utils';
import { User } from '../models/user.entity';

export function unlockAchievements(user: User, updatedFields: string[]): boolean {
    if (!user.weeklyStats || !user.totalStats) {
        return false;
    }
    if (!user as any) return false;

    const updatedSet = new Set(updatedFields);
    const unlocked = (user as any).unlockedAchievements as string[] | undefined;
    const unlockedSet = new Set(unlocked || []);
    let changed = false;

    for (const achievement of ACHIEVEMENTS) {
        if (!updatedSet.has(achievement.statField)) {
            continue;
        }

        const pathParts = achievement.statField.split('.');
        let current: any = user;
        for (const part of pathParts) {
            if (current == null) break;
            current = current[part];
        }
        const value = typeof current === 'number' ? current : 0;

        if (value >= achievement.threshold && !unlockedSet.has(achievement.id)) {
            unlockedSet.add(achievement.id);
            changed = true;
        }
    }

    if (changed) {
        (user as any).unlockedAchievements = Array.from(unlockedSet);
    }

    return changed;
}


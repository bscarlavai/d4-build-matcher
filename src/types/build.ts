export interface PriorityAffix {
  name: string;
  weight: number;
}

export interface SlotRequirements {
  slot: string;
  priority_uniques?: string[];
  priority_aspects?: string[];
  priority_affixes?: PriorityAffix[];
  required_tempers?: string[];
}

export interface BuildProfile {
  name: string;
  gear: Record<string, SlotRequirements>;
}

export interface Build {
  id: string;
  name: string;
  class: string;
  category: string;
  source_url: string;
  tier: string;
  tags: string[];
  last_updated: string;
  profile_order: string[];
  profiles: Record<string, BuildProfile>;
}

export type ItemTier = 'bis' | 'ancestral' | 'starter' | 'not_recommended' | 'none';

export interface ItemWithScore {
  item: import('./item').Item | null;
  score: number;
  maxScore: number;
  notes: string;
  tier: ItemTier;
}

export interface MissingItem {
  slot: string;
  item: string;
  importance: 'high' | 'medium' | 'low';
}

export interface UpgradePriority {
  slot: string;
  suggestion: string;
}

export interface ProfileMatch {
  profileName: string;
  profileDisplayName: string;
  score: number;
  maxScore: number;
  percentage: number;
  recommendedLoadout: Record<string, ItemWithScore>;
  missingCritical: MissingItem[];
  upgradePriorities: UpgradePriority[];
}

export interface BuildMatch {
  buildId: string;
  buildName: string;
  tier: string;
  profileMatches: ProfileMatch[];
  bestProfile: string;
  bestPercentage: number;
  sourceUrl: string;
}

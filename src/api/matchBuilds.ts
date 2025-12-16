import type { Item, UserGear, Build, BuildMatch, SlotRequirements, ItemWithScore, MissingItem, UpgradePriority, ItemTier } from '../types';

// Tier thresholds
const TIER_THRESHOLDS = {
  BIS: 0.75,        // 75%+ of max score = BiS
  ANCESTRAL: 0.40,  // 40-74% = Ancestral viable
  STARTER: 0.15,    // 15-39% = Starter viable
};

export interface ScoredItem {
  score: number;
  tier: ItemTier;
  hasPriorityUnique: boolean;
  uniqueRank: number | null; // 0 = BiS, 1 = secondary, etc.
  matchingAffixes: number;
  totalPriorityAffixes: number;
  hasAspect: boolean;
}

export function matchBuilds(userGear: UserGear, builds: Build[]): BuildMatch[] {
  const matches: BuildMatch[] = [];

  for (const build of builds) {
    let totalScore = 0;
    let maxPossibleScore = 0;
    const recommendedLoadout: Record<string, ItemWithScore> = {};
    const missingCritical: MissingItem[] = [];
    const upgradePriorities: UpgradePriority[] = [];

    for (const [slot, requirements] of Object.entries(build.gear)) {
      const userItems = userGear[slot] || [];

      // Calculate max possible score for this slot
      const slotMaxScore = calculateSlotMaxScore(requirements);
      maxPossibleScore += slotMaxScore;

      if (userItems.length === 0) {
        // User has no item for this slot
        if (requirements.priority_uniques && requirements.priority_uniques.length > 0) {
          missingCritical.push({
            slot,
            item: requirements.priority_uniques[0],
            importance: 'high',
          });
        }
        recommendedLoadout[slot] = {
          item: null,
          score: 0,
          maxScore: slotMaxScore,
          notes: 'No item scanned',
          tier: 'none',
        };
        continue;
      }

      // Score each user item for this slot, pick the best
      let bestItem: Item | null = null;
      let bestScored: ScoredItem | null = null;

      for (const item of userItems) {
        const scored = scoreItemForSlot(item, requirements);
        if (!bestScored || scored.score > bestScored.score) {
          bestScored = scored;
          bestItem = item;
        }
      }

      const score = bestScored?.score || 0;
      totalScore += score;

      const tier = bestScored?.tier || 'not_recommended';
      const notes = bestItem && bestScored
        ? generateNotes(bestItem, bestScored, requirements)
        : 'Item does not match build';

      recommendedLoadout[slot] = {
        item: bestItem,
        score,
        maxScore: slotMaxScore,
        notes,
        tier,
      };

      // Check if this slot needs upgrade
      if (tier === 'not_recommended' || tier === 'starter') {
        upgradePriorities.push({
          slot,
          suggestion: generateUpgradeSuggestion(requirements),
        });
      }
    }

    const percentage = maxPossibleScore > 0 ? (totalScore / maxPossibleScore) * 100 : 0;

    matches.push({
      buildId: build.id,
      buildName: build.name,
      tier: build.tier,
      score: totalScore,
      maxScore: maxPossibleScore,
      percentage: Math.round(percentage * 10) / 10,
      recommendedLoadout,
      missingCritical,
      upgradePriorities,
      sourceUrl: build.source_url,
    });
  }

  // Sort by percentage descending, then by build name alphabetically
  return matches.sort((a, b) => {
    if (b.percentage !== a.percentage) {
      return b.percentage - a.percentage;
    }
    return a.buildName.localeCompare(b.buildName);
  });
}

function scoreItemForSlot(item: Item, requirements: SlotRequirements): ScoredItem {
  let score = 0;
  let hasPriorityUnique = false;
  let uniqueRank: number | null = null;
  let hasAspect = false;
  let matchingAffixes = 0;
  const totalPriorityAffixes = requirements.priority_affixes?.length || 0;

  // Check for priority unique match (case-insensitive)
  if (item.is_unique && item.unique_id && requirements.priority_uniques) {
    const itemUniqueLower = item.unique_id.toLowerCase();
    const matchIndex = requirements.priority_uniques.findIndex(
      (u) => u.toLowerCase() === itemUniqueLower
    );
    if (matchIndex !== -1) {
      hasPriorityUnique = true;
      uniqueRank = matchIndex;
      // First priority unique = 100 points, second = 80, etc.
      score += 100 - matchIndex * 20;
    }
  }

  // Aspect match
  if (item.aspect && requirements.priority_aspects?.includes(item.aspect.name)) {
    hasAspect = true;
    score += 50;
  }

  // Affix matches (weighted)
  const allAffixes = [
    ...item.affixes.map((a) => a.name.toLowerCase()),
    ...item.tempered_affixes.map((a) => a.name.toLowerCase()),
  ];

  for (const requiredAffix of requirements.priority_affixes || []) {
    const affixNameLower = requiredAffix.name.toLowerCase();
    if (allAffixes.includes(affixNameLower)) {
      matchingAffixes++;
      score += requiredAffix.weight;

      // Bonus for greater affix
      const gaLower = item.greater_affixes?.map(g => g.toLowerCase()) || [];
      if (gaLower.includes(affixNameLower)) {
        score += requiredAffix.weight * 0.5;
      }
    }
  }

  // Required temper match
  for (const temper of requirements.required_tempers || []) {
    if (item.tempered_affixes.some((a) => a.name.toLowerCase() === temper.toLowerCase())) {
      score += 25;
    }
  }

  // IMPORTANT: If item has NOTHING the build wants, score is 0
  const hasAnythingUseful = hasPriorityUnique || hasAspect || matchingAffixes > 0;
  if (!hasAnythingUseful) {
    return {
      score: 0,
      tier: 'not_recommended',
      hasPriorityUnique: false,
      uniqueRank: null,
      matchingAffixes: 0,
      totalPriorityAffixes,
      hasAspect: false,
    };
  }

  // Item power bonus (only if item is useful for the build)
  const ipScore = Math.min(10, Math.max(0, (item.item_power - 800) / 12.5));
  score += ipScore;

  // Determine tier based on score percentage and what matches
  const maxScore = calculateSlotMaxScore(requirements);
  const scorePercent = maxScore > 0 ? score / maxScore : 0;

  let tier: ItemTier;
  if (hasPriorityUnique && uniqueRank === 0 && scorePercent >= TIER_THRESHOLDS.BIS) {
    tier = 'bis';
  } else if (hasPriorityUnique || scorePercent >= TIER_THRESHOLDS.ANCESTRAL) {
    tier = 'ancestral';
  } else if (scorePercent >= TIER_THRESHOLDS.STARTER || matchingAffixes >= 1) {
    tier = 'starter';
  } else {
    tier = 'not_recommended';
  }

  return {
    score,
    tier,
    hasPriorityUnique,
    uniqueRank,
    matchingAffixes,
    totalPriorityAffixes,
    hasAspect,
  };
}

function calculateSlotMaxScore(requirements: SlotRequirements): number {
  let max = 0;

  // Best unique = 100
  if (requirements.priority_uniques && requirements.priority_uniques.length > 0) {
    max += 100;
  }

  // Aspect = 50
  if (requirements.priority_aspects && requirements.priority_aspects.length > 0) {
    max += 50;
  }

  // All affixes at weight + 50% GA bonus
  for (const affix of requirements.priority_affixes || []) {
    max += affix.weight * 1.5;
  }

  // Tempers = 25 each
  max += (requirements.required_tempers?.length || 0) * 25;

  // Max item power bonus
  max += 10;

  // Ensure minimum max score for percentage calculations
  return Math.max(max, 10);
}

function generateNotes(_item: Item, scored: ScoredItem, _requirements: SlotRequirements): string {
  const notes: string[] = [];

  // Tier indicator first
  switch (scored.tier) {
    case 'bis':
      notes.push('✅ BiS');
      break;
    case 'ancestral':
      if (scored.hasPriorityUnique && scored.uniqueRank !== 0) {
        notes.push('✅ Good unique');
      } else {
        notes.push('⚡ Ancestral viable');
      }
      break;
    case 'starter':
      notes.push('⚡ Starter viable');
      break;
    case 'not_recommended':
      notes.push('❌ Not recommended');
      break;
  }

  // Add detail about why
  if (scored.hasPriorityUnique && scored.uniqueRank === 0) {
    // Already said BiS, no need for more unique info
  } else if (scored.totalPriorityAffixes > 0) {
    notes.push(`${scored.matchingAffixes}/${scored.totalPriorityAffixes} affixes`);
  }

  if (scored.hasAspect) {
    notes.push('has aspect');
  }

  return notes.join(' · ');
}

function generateUpgradeSuggestion(requirements: SlotRequirements): string {
  if (requirements.priority_uniques && requirements.priority_uniques.length > 0) {
    return `Look for ${requirements.priority_uniques[0]}`;
  } else if (requirements.priority_affixes && requirements.priority_affixes.length > 0) {
    const topAffixes = requirements.priority_affixes
      .slice(0, 2)
      .map((a) => a.name.replace(/_/g, ' '))
      .join(' + ');
    return `Look for ${topAffixes}`;
  }
  return 'Find a better item';
}

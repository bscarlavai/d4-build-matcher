import type { Item, UserGear, Build, BuildMatch, SlotRequirements, ItemWithScore, MissingItem, UpgradePriority } from '../types';

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
        };
        continue;
      }

      // Score each user item for this slot, pick the best
      let bestItem: Item | null = null;
      let bestScore = -1;

      for (const item of userItems) {
        const score = scoreItemForSlot(item, requirements);
        if (score > bestScore) {
          bestScore = score;
          bestItem = item;
        }
      }

      // Ensure bestScore is at least 0 for calculations
      bestScore = Math.max(0, bestScore);
      totalScore += bestScore;
      const notes = bestItem
        ? generateNotes(bestItem, requirements, bestScore, slotMaxScore)
        : 'Item does not match build';

      recommendedLoadout[slot] = {
        item: bestItem,
        score: bestScore,
        maxScore: slotMaxScore,
        notes,
      };

      // Check if this slot needs upgrade
      const scorePercentage = (bestScore / slotMaxScore) * 100;
      if (scorePercentage < 50) {
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

  // Sort by percentage descending
  return matches.sort((a, b) => b.percentage - a.percentage);
}

function scoreItemForSlot(item: Item, requirements: SlotRequirements): number {
  let score = 0;

  // Unique match (highest value)
  if (item.is_unique && item.unique_id && requirements.priority_uniques?.includes(item.unique_id)) {
    const uniqueIndex = requirements.priority_uniques.indexOf(item.unique_id);
    // First priority unique = 100 points, second = 80, etc.
    score += 100 - uniqueIndex * 20;
  }

  // Aspect match
  if (item.aspect && requirements.priority_aspects?.includes(item.aspect.name)) {
    score += 50;
  }

  // Affix matches (weighted)
  const allAffixes = [
    ...item.affixes.map((a) => a.name),
    ...item.tempered_affixes.map((a) => a.name),
  ];

  for (const requiredAffix of requirements.priority_affixes || []) {
    if (allAffixes.includes(requiredAffix.name)) {
      score += requiredAffix.weight;

      // Bonus for greater affix
      if (item.greater_affixes?.includes(requiredAffix.name)) {
        score += requiredAffix.weight * 0.5;
      }
    }
  }

  // Required temper match
  for (const temper of requirements.required_tempers || []) {
    if (item.tempered_affixes.some((a) => a.name === temper)) {
      score += 25;
    }
  }

  // Item power bonus (scale 0-10 based on 800-925 range)
  const ipScore = Math.min(10, Math.max(0, (item.item_power - 800) / 12.5));
  score += ipScore;

  return score;
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

  return max;
}

function generateNotes(item: Item, requirements: SlotRequirements, score: number, maxScore: number): string {
  const notes: string[] = [];

  // Check unique match
  if (item.is_unique && item.unique_id) {
    if (requirements.priority_uniques?.includes(item.unique_id)) {
      const index = requirements.priority_uniques.indexOf(item.unique_id);
      if (index === 0) {
        notes.push('BiS unique');
      } else {
        notes.push('Good unique');
      }
    }
  }

  // Check aspect
  if (item.aspect && requirements.priority_aspects?.includes(item.aspect.name)) {
    notes.push('Has priority aspect');
  }

  // Count matching affixes
  const allAffixes = [
    ...item.affixes.map((a) => a.name),
    ...item.tempered_affixes.map((a) => a.name),
  ];
  const matchingAffixes = (requirements.priority_affixes || []).filter((a) =>
    allAffixes.includes(a.name)
  ).length;
  const totalPriorityAffixes = requirements.priority_affixes?.length || 0;

  if (totalPriorityAffixes > 0) {
    notes.push(`${matchingAffixes}/${totalPriorityAffixes} priority affixes`);
  }

  // Check tempers
  const matchingTempers = (requirements.required_tempers || []).filter((t) =>
    item.tempered_affixes.some((a) => a.name === t)
  ).length;
  const totalTempers = requirements.required_tempers?.length || 0;

  if (totalTempers > 0 && matchingTempers === totalTempers) {
    notes.push('Has required tempers');
  }

  if (notes.length === 0) {
    const pct = Math.round((score / maxScore) * 100);
    notes.push(`${pct}% match`);
  }

  return notes.join(', ');
}

function generateUpgradeSuggestion(requirements: SlotRequirements): string {
  const suggestions: string[] = [];

  if (requirements.priority_uniques && requirements.priority_uniques.length > 0) {
    suggestions.push(`Look for ${requirements.priority_uniques[0].replace(/_/g, ' ')}`);
  } else if (requirements.priority_affixes && requirements.priority_affixes.length > 0) {
    const topAffixes = requirements.priority_affixes
      .slice(0, 2)
      .map((a) => a.name.replace(/_/g, ' '))
      .join(' + ');
    suggestions.push(`Look for ${topAffixes}`);
  }

  return suggestions[0] || 'Find a better item';
}

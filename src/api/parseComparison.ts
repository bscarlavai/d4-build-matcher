import Anthropic from '@anthropic-ai/sdk';
import type { Item } from '../types';

export interface ComparisonResult {
  newItem: Item;
  equippedItem: Item;
}

const COMPARISON_PROMPT = `Parse this Diablo 4 item comparison tooltip showing TWO items side by side.

The LEFT item is the NEW item being considered.
The RIGHT item is the CURRENTLY EQUIPPED item (usually marked "EQUIPPED" at the top).

Return ONLY valid JSON with this exact structure:
{
  "newItem": {
    "name": "item name",
    "type": "item type (helm/chest/gloves/pants/boots/amulet/ring/weapon/offhand)",
    "item_power": number,
    "is_unique": boolean,
    "unique_id": "Exact Unique Item Name with Title Case or null",
    "affixes": [
      { "name": "affix_name_lowercase_underscores", "value": number }
    ],
    "tempered_affixes": [
      { "name": "affix_name", "value": number }
    ],
    "greater_affixes": ["affix_name"],
    "aspect": {
      "name": "aspect_name_lowercase_underscores",
      "description": "full aspect/unique power text",
      "value": primary_percentage_or_numeric_value
    },
    "sockets": { "total": number, "filled": number },
    "class_restriction": "class name or null"
  },
  "equippedItem": {
    // Same structure as newItem
  }
}

IMPORTANT PARSING RULES:
1. BASE STATS are NOT affixes. These appear at the top and include:
   - Armor value (e.g., "1,131 Armor")
   - Blocked Damage Reduction %
   - Block Chance %
   - Damage Per Second for weapons
   - Attacks per Second
   - Main Hand Weapon Damage
   Do NOT include these in affixes or tempered_affixes.

2. REGULAR AFFIXES have a small diamond bullet point and white/gray text.
   Examples: "+255 Maximum Life", "+339 Armor", "+3 to Core Skills"

3. TEMPERED AFFIXES have a special icon and YELLOW/GOLD text.
   Examples: "+30.0% Chance for Shield Bash to Deal Double Damage"
   Include "ranks_to_" prefix for skill rank affixes.

4. GREATER AFFIXES are marked with a star/asterisk icon, indicating they rolled higher.
   List the affix name in greater_affixes array.

5. UNIQUE POWER: For unique items, the special ability text goes in aspect.description.
   Extract the primary numeric value as aspect.value.

6. Normalize ALL affix names to lowercase with underscores:
   "Maximum Life" → "maximum_life"
   "Core Skills" → "core_skills"
   "Damage Reduction" → "damage_reduction"
   "Shield Bash" → "ranks_to_shield_bash" (for skill ranks)

7. IGNORE the "Properties lost when equipped" section - we parse both items separately.

8. For shields, the type should be "offhand".

Return ONLY the JSON, no markdown formatting, no explanation.`;

export async function parseComparison(imageBase64: string): Promise<ComparisonResult> {
  const devApiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;

  if (devApiKey) {
    // Local development: call Anthropic directly
    const anthropic = new Anthropic({
      apiKey: devApiKey,
      dangerouslyAllowBrowser: true,
    });

    console.log('Sending comparison image to Claude, base64 length:', imageBase64.length);

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: imageBase64,
              },
            },
            {
              type: 'text',
              text: COMPARISON_PROMPT,
            },
          ],
        },
      ],
    });

    console.log('Claude comparison response:', response);

    const jsonText = response.content[0].type === 'text' ? response.content[0].text : '';
    const cleanJson = jsonText
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    console.log('Parsed comparison JSON:', cleanJson);

    return JSON.parse(cleanJson);
  } else {
    // Production: call the worker endpoint
    const response = await fetch('/api/parse-comparison', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageBase64 }),
    });

    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error || 'Failed to parse comparison');
    }
    return {
      newItem: data.newItem,
      equippedItem: data.equippedItem,
    };
  }
}

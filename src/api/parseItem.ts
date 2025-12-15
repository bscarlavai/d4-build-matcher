import Anthropic from '@anthropic-ai/sdk';
import type { Item } from '../types';

const PARSE_PROMPT = `Parse this Diablo 4 item tooltip and return ONLY valid JSON with this exact structure:
{
  "name": "item name",
  "type": "item type (helm/chest/gloves/pants/boots/amulet/ring/weapon/offhand)",
  "item_power": number,
  "is_unique": boolean,
  "unique_id": "lowercase_underscore_name or null",
  "affixes": [
    { "name": "affix_name_lowercase_underscores", "value": number }
  ],
  "tempered_affixes": [
    { "name": "affix_name", "value": number }
  ],
  "greater_affixes": ["affix_name"],
  "aspect": {
    "name": "aspect_name_lowercase_underscores",
    "description": "full aspect text",
    "value": primary_percentage_or_numeric_value
  },
  "sockets": { "total": number, "filled": number },
  "class_restriction": "class name or null"
}

IMPORTANT PARSING RULES:
1. BASE STATS are NOT affixes. These appear at the top and include:
   - Armor value (e.g., "1,886 Armor")
   - Toughness % (e.g., "+7.7% Toughness")
   - Damage Per Second for weapons
   - Attacks per Second
   Do NOT include these in affixes or tempered_affixes.

2. REGULAR AFFIXES have a small diamond bullet point and white/gray text.
   Examples: "+119 Strength", "+450 Maximum Life", "+11.5% Total Resistance"

3. TEMPERED AFFIXES have a special icon and YELLOW/GOLD text.
   Examples: "+5 to Heavyweight", "+15% Cooldown Reduction"
   Include "ranks_to_" prefix for skill rank affixes.

4. GREATER AFFIXES have an additional marker/icon indicating they rolled higher.

5. ASPECT: Extract the first percentage value from the aspect text as "value".
   Example: "Rally Fortifies you for 7.4% of your Maximum Life" → value: 7.4

6. Normalize ALL names to lowercase with underscores:
   "Maximum Life" → "maximum_life"
   "Critical Strike Chance" → "critical_strike_chance"
   "Heavyweight" → "ranks_to_heavyweight" (for skill ranks)

Return ONLY the JSON, no markdown formatting, no explanation.`;

export async function parseItem(imageBase64: string, playerClass: string): Promise<Item> {
  const devApiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;

  if (devApiKey) {
    // Local development: call Anthropic directly
    const anthropic = new Anthropic({
      apiKey: devApiKey,
      dangerouslyAllowBrowser: true,
    });

    console.log('Sending image to Claude, base64 length:', imageBase64.length);

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
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
              text: PARSE_PROMPT,
            },
          ],
        },
      ],
    });

    console.log('Claude response:', response);

    const jsonText = response.content[0].type === 'text' ? response.content[0].text : '';
    const cleanJson = jsonText
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    console.log('Parsed JSON:', cleanJson);

    return JSON.parse(cleanJson);
  } else {
    // Production: call the worker endpoint
    const response = await fetch('/api/parse-item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageBase64, playerClass }),
    });

    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error || 'Failed to parse item');
    }
    return data.item;
  }
}

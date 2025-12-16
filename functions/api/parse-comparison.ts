import Anthropic from '@anthropic-ai/sdk';

interface Env {
  ANTHROPIC_API_KEY: string;
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

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { image } = await context.request.json() as { image: string };

    if (!image) {
      return new Response(JSON.stringify({
        success: false,
        error: 'No image provided'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const anthropic = new Anthropic({
      apiKey: context.env.ANTHROPIC_API_KEY,
    });

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
                data: image,
              },
            },
            {
              type: 'text',
              text: COMPARISON_PROMPT
            }
          ],
        }
      ],
    });

    const jsonText = response.content[0].type === 'text' ? response.content[0].text : '';

    // Clean up response in case model adds markdown formatting
    const cleanJson = jsonText
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    const result = JSON.parse(cleanJson);

    return new Response(JSON.stringify({
      success: true,
      newItem: result.newItem,
      equippedItem: result.equippedItem
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Parse comparison error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to parse comparison'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

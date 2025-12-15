import Anthropic from '@anthropic-ai/sdk';

interface Env {
  ANTHROPIC_API_KEY: string;
}

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

2. REGULAR AFFIXES have a small diamond (◆) bullet point and white/gray text.
   Examples: "+119 Strength", "+450 Maximum Life", "+11.5% Total Resistance"

3. TEMPERED AFFIXES have a special icon (✦ or flower-like) and YELLOW/GOLD text.
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

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { image, playerClass } = await context.request.json() as {
      image: string;
      playerClass: string
    };

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
                data: image,
              },
            },
            {
              type: 'text',
              text: PARSE_PROMPT
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

    const item = JSON.parse(cleanJson);

    return new Response(JSON.stringify({
      success: true,
      item
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Parse error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to parse item'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

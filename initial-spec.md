# D4 Build Matcher - Technical Design Specification

## Project Overview

**Goal**: Build a mobile-first web app that lets Diablo 4 players photograph their gear tooltips and get recommendations for which Maxroll builds best match their current equipment.

**Core Value Proposition**: "Point your phone at your TV, scan your gear, find your best build."

---

## User Flow

```
1. User opens web app on phone
2. Selects their class (Paladin, Barbarian, etc.)
3. Taps "Scan Gear"
4. Camera opens, user points at D4 tooltip on TV/monitor
5. App captures image when user taps or auto-detects tooltip
6. Vision API parses tooltip → structured JSON
7. User confirms parsed data or retakes
8. Repeat for each gear slot (or as many items as they want)
9. App runs build matching algorithm
10. Shows ranked list of builds with:
    - Match percentage
    - Recommended loadout from their gear
    - Missing critical items
    - Links to full Maxroll guides
```

---

## Technical Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND (React)                          │
│                    Hosted on Cloudflare Pages                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ Camera View │  │ Gear List   │  │ Build Results           │  │
│  │ (capture)   │  │ (inventory) │  │ (recommendations)       │  │
│  └──────┬──────┘  └──────┬──────┘  └────────────┬────────────┘  │
└─────────┼────────────────┼──────────────────────┼───────────────┘
          │                │                      │
          ▼                ▼                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                 API LAYER (Cloudflare Workers)                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ /parse-item │  │ /user-gear  │  │ /match-builds           │  │
│  │ (vision AI) │  │ (CRUD)      │  │ (algorithm)             │  │
│  └──────┬──────┘  └──────┬──────┘  └────────────┬────────────┘  │
└─────────┼────────────────┼──────────────────────┼───────────────┘
          │                │                      │
          ▼                ▼                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                        DATA LAYER                                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ Claude API  │  │ Supabase    │  │ Static JSON             │  │
│  │ (Haiku)     │  │ (user data) │  │ (builds, affixes)       │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Models

### 1. Static Game Data (from D4LF project)

Store these JSON files in `/public/data/` or fetch from CDN:

```
/data
  /game
    affixes.json        # All possible affixes with normalized names
    item_types.json     # Gear slot definitions  
    uniques.json        # All unique items
    aspects.json        # All legendary aspects
    classes.json        # Class definitions
  /builds
    index.json          # Build metadata and list
    /paladin
      blessed-hammer.json
      fist-of-heavens.json
      ...
    /barbarian
      ...
```

#### affixes.json structure (from D4LF):
```json
{
  "strength": "strength",
  "dexterity": "dexterity", 
  "intelligence": "intelligence",
  "willpower": "willpower",
  "maximum_life": "maximum life",
  "critical_strike_chance": "critical strike chance",
  "critical_strike_damage": "critical strike damage",
  "attack_speed": "attack speed",
  "cooldown_reduction": "cooldown reduction",
  "lucky_hit_chance": "lucky hit chance",
  "total_resistance": "total resistance",
  "armor": "armor",
  ...
}
```

#### Build file structure:
```json
{
  "id": "blessed-hammer-paladin",
  "name": "Blessed Hammer Paladin",
  "class": "paladin",
  "source_url": "https://maxroll.gg/d4/build-guides/blessed-hammer-paladin-guide",
  "tier": "S",
  "tags": ["endgame", "aoe", "holy"],
  "last_updated": "2024-12-14",
  "gear": {
    "helm": {
      "slot": "helm",
      "priority_uniques": ["harlequin_crest", "tuskhelm_of_joritz"],
      "priority_aspects": ["aspect_of_disobedience", "aspect_of_might"],
      "priority_affixes": [
        { "name": "cooldown_reduction", "weight": 10 },
        { "name": "maximum_life", "weight": 8 },
        { "name": "total_armor", "weight": 5 },
        { "name": "strength", "weight": 3 }
      ],
      "required_tempers": ["ranks_to_heavyweight"]
    },
    "chest": { ... },
    "gloves": { ... },
    "pants": { ... },
    "boots": { ... },
    "amulet": { ... },
    "ring1": { ... },
    "ring2": { ... },
    "weapon": { ... },
    "offhand": { ... }
  }
}
```

### 2. User Data (Supabase)

#### users table:
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### user_gear table:
```sql
CREATE TABLE user_gear (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  class VARCHAR(50) NOT NULL,
  slot VARCHAR(50) NOT NULL,
  item_data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for fast lookups
CREATE INDEX idx_user_gear_user_class ON user_gear(user_id, class);
```

#### item_data JSONB structure:
```json
{
  "name": "Arcadia",
  "type": "pants",
  "item_power": 800,
  "is_unique": true,
  "unique_id": "arcadia",
  "affixes": [
    { "name": "strength", "value": 119 },
    { "name": "maximum_life", "value": 450 },
    { "name": "total_resistance", "value": 11.5 }
  ],
  "tempered_affixes": [
    { "name": "ranks_to_heavyweight", "value": 5 }
  ],
  "greater_affixes": [],
  "aspect": {
    "id": "arcadia_aspect",
    "value": 7.4
  },
  "sockets": { "total": 1, "filled": 0 },
  "source_image_url": "https://storage.../image.jpg"
}
```

---

## API Endpoints

### POST /api/parse-item

Receives image, returns parsed item data.

**Request:**
```json
{
  "image": "base64_encoded_image_data",
  "class": "paladin"
}
```

**Implementation:**
```typescript
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic();

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

export async function parseItemImage(imageBase64: string, playerClass: string) {
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",  // Using Haiku for cost efficiency
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/jpeg",
              data: imageBase64,
            },
          },
          {
            type: "text",
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
  
  return JSON.parse(cleanJson);
}
```

**Response:**
```json
{
  "success": true,
  "item": {
    "name": "Arcadia",
    "type": "pants",
    "item_power": 800,
    "is_unique": true,
    "unique_id": "arcadia",
    "affixes": [
      { "name": "strength", "value": 119 },
      { "name": "maximum_life", "value": 450 },
      { "name": "total_resistance", "value": 11.5 }
    ],
    "tempered_affixes": [
      { "name": "ranks_to_heavyweight", "value": 5 }
    ],
    "greater_affixes": [],
    "aspect": {
      "name": "Arcadia",
      "description": "Rally Fortifies you for 7.4% of your Maximum Life...",
      "value": 7.4
    },
    "sockets": { "total": 1, "filled": 0 },
    "class_restriction": "paladin"
  }
}
```

### POST /api/match-builds

Takes user's gear inventory and returns ranked build matches.

**Request:**
```json
{
  "class": "paladin",
  "gear": {
    "helm": [ { ...item1 }, { ...item2 } ],
    "chest": [ { ...item } ],
    "pants": [ { ...item } ],
    ...
  }
}
```

**Response:**
```json
{
  "matches": [
    {
      "build_id": "blessed-hammer-paladin",
      "build_name": "Blessed Hammer Paladin",
      "tier": "S",
      "score": 847,
      "max_score": 1000,
      "percentage": 84.7,
      "recommended_loadout": {
        "helm": { "item": {...}, "score": 95, "notes": "BiS unique" },
        "chest": { "item": {...}, "score": 72, "notes": "3/4 priority affixes" },
        ...
      },
      "missing_critical": [
        { "slot": "amulet", "item": "Melted Heart of Selig", "importance": "high" }
      ],
      "upgrade_priorities": [
        { "slot": "gloves", "suggestion": "Look for Attack Speed + Crit Chance" }
      ],
      "source_url": "https://maxroll.gg/d4/build-guides/..."
    },
    ...
  ]
}
```

---

## Build Matching Algorithm

```typescript
interface BuildMatch {
  buildId: string;
  score: number;
  maxScore: number;
  recommendedLoadout: Record<string, ItemWithScore>;
  missingCritical: MissingItem[];
}

function matchBuilds(userGear: UserGear, builds: Build[]): BuildMatch[] {
  const matches: BuildMatch[] = [];

  for (const build of builds) {
    let totalScore = 0;
    let maxPossibleScore = 0;
    const recommendedLoadout: Record<string, ItemWithScore> = {};
    const missingCritical: MissingItem[] = [];

    for (const [slot, requirements] of Object.entries(build.gear)) {
      const userItems = userGear[slot] || [];
      
      // Calculate max possible score for this slot
      const slotMaxScore = calculateSlotMaxScore(requirements);
      maxPossibleScore += slotMaxScore;

      if (userItems.length === 0) {
        // User has no item for this slot
        if (requirements.priority_uniques?.length > 0) {
          missingCritical.push({
            slot,
            item: requirements.priority_uniques[0],
            importance: 'high'
          });
        }
        continue;
      }

      // Score each user item for this slot, pick the best
      let bestItem = null;
      let bestScore = 0;

      for (const item of userItems) {
        const score = scoreItemForSlot(item, requirements);
        if (score > bestScore) {
          bestScore = score;
          bestItem = item;
        }
      }

      totalScore += bestScore;
      recommendedLoadout[slot] = {
        item: bestItem,
        score: bestScore,
        maxScore: slotMaxScore,
        notes: generateNotes(bestItem, requirements)
      };
    }

    matches.push({
      buildId: build.id,
      score: totalScore,
      maxScore: maxPossibleScore,
      percentage: (totalScore / maxPossibleScore) * 100,
      recommendedLoadout,
      missingCritical
    });
  }

  // Sort by percentage descending
  return matches.sort((a, b) => b.percentage - a.percentage);
}

function scoreItemForSlot(item: Item, requirements: SlotRequirements): number {
  let score = 0;

  // Unique match (highest value)
  if (item.is_unique && requirements.priority_uniques?.includes(item.unique_id)) {
    const uniqueIndex = requirements.priority_uniques.indexOf(item.unique_id);
    // First priority unique = 100 points, second = 80, etc.
    score += 100 - (uniqueIndex * 20);
  }

  // Aspect match
  if (item.aspect && requirements.priority_aspects?.includes(item.aspect.id)) {
    score += 50;
  }

  // Affix matches (weighted)
  const allAffixes = [
    ...item.affixes.map(a => a.name),
    ...item.tempered_affixes.map(a => a.name)
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
    if (item.tempered_affixes.some(a => a.name === temper)) {
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
  if (requirements.priority_uniques?.length > 0) max += 100;
  
  // Aspect = 50
  if (requirements.priority_aspects?.length > 0) max += 50;
  
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
```

---

## Frontend Components

### Tech Stack
- **Framework**: React 18+ with TypeScript
- **Styling**: Tailwind CSS
- **Camera**: react-webcam or native MediaDevices API
- **State**: Zustand or React Context
- **Routing**: React Router
- **HTTP**: fetch or axios

### Component Structure

```
/src
  /components
    /camera
      CameraCapture.tsx       # Live camera view + capture
      TooltipOverlay.tsx      # Alignment guide overlay
    /gear
      GearSlot.tsx            # Single gear slot display
      GearInventory.tsx       # All slots grid view
      ItemCard.tsx            # Parsed item display
      ItemEditor.tsx          # Manual correction UI
    /builds
      BuildCard.tsx           # Single build match result
      BuildList.tsx           # Ranked results list
      LoadoutView.tsx         # Recommended gear per build
      MissingItems.tsx        # What to farm next
    /common
      ClassSelector.tsx       # Class picker
      Header.tsx
      LoadingSpinner.tsx
  /hooks
    useCamera.ts              # Camera access hook
    useGear.ts                # Gear state management
    useBuilds.ts              # Build data fetching
  /api
    parseItem.ts              # /api/parse-item calls
    matchBuilds.ts            # /api/match-builds calls
  /types
    item.ts                   # Item type definitions
    build.ts                  # Build type definitions
  /data
    affixes.json              # Static affix data
    builds/                   # Build JSON files
```

### CameraCapture.tsx

```tsx
import React, { useRef, useCallback, useState } from 'react';
import Webcam from 'react-webcam';

interface CameraCaptureProps {
  onCapture: (imageBase64: string) => void;
  onCancel: () => void;
}

export function CameraCapture({ onCapture, onCancel }: CameraCaptureProps) {
  const webcamRef = useRef<Webcam>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const capture = useCallback(() => {
    const imageSrc = webcamRef.current?.getScreenshot();
    if (imageSrc) {
      // Remove data:image/jpeg;base64, prefix
      const base64 = imageSrc.split(',')[1];
      onCapture(base64);
    }
  }, [onCapture]);

  const videoConstraints = {
    facingMode: 'environment', // Use rear camera
    width: { ideal: 1920 },
    height: { ideal: 1080 }
  };

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col">
      {/* Camera View */}
      <div className="flex-1 relative">
        <Webcam
          ref={webcamRef}
          audio={false}
          screenshotFormat="image/jpeg"
          screenshotQuality={0.9}
          videoConstraints={videoConstraints}
          className="w-full h-full object-cover"
        />
        
        {/* Alignment Guide Overlay */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="border-2 border-white/50 rounded-lg w-80 h-96 flex items-center justify-center">
            <span className="text-white/70 text-sm">Align tooltip here</span>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="p-4 flex justify-center gap-4 bg-black/80">
        <button
          onClick={onCancel}
          className="px-6 py-3 bg-gray-700 text-white rounded-full"
        >
          Cancel
        </button>
        <button
          onClick={capture}
          disabled={isProcessing}
          className="px-8 py-3 bg-red-600 text-white rounded-full font-bold"
        >
          {isProcessing ? 'Processing...' : 'Capture'}
        </button>
      </div>
    </div>
  );
}
```

### Main App Flow

```tsx
// App.tsx
import React, { useState } from 'react';
import { ClassSelector } from './components/common/ClassSelector';
import { CameraCapture } from './components/camera/CameraCapture';
import { GearInventory } from './components/gear/GearInventory';
import { BuildList } from './components/builds/BuildList';
import { parseItem, matchBuilds } from './api';

type AppState = 'select-class' | 'inventory' | 'camera' | 'results';

export function App() {
  const [state, setState] = useState<AppState>('select-class');
  const [playerClass, setPlayerClass] = useState<string | null>(null);
  const [gear, setGear] = useState<Record<string, Item[]>>({});
  const [buildMatches, setBuildMatches] = useState<BuildMatch[] | null>(null);
  const [currentSlot, setCurrentSlot] = useState<string | null>(null);

  const handleClassSelect = (cls: string) => {
    setPlayerClass(cls);
    setState('inventory');
  };

  const handleScanSlot = (slot: string) => {
    setCurrentSlot(slot);
    setState('camera');
  };

  const handleCapture = async (imageBase64: string) => {
    try {
      const result = await parseItem(imageBase64, playerClass!);
      
      // Add to gear inventory
      setGear(prev => ({
        ...prev,
        [result.item.type]: [...(prev[result.item.type] || []), result.item]
      }));
      
      setState('inventory');
    } catch (error) {
      console.error('Failed to parse item:', error);
      // Show error toast, let user retry
    }
  };

  const handleFindBuilds = async () => {
    const matches = await matchBuilds(playerClass!, gear);
    setBuildMatches(matches);
    setState('results');
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {state === 'select-class' && (
        <ClassSelector onSelect={handleClassSelect} />
      )}
      
      {state === 'inventory' && (
        <GearInventory
          gear={gear}
          onScanSlot={handleScanSlot}
          onFindBuilds={handleFindBuilds}
          onRemoveItem={(slot, index) => {
            setGear(prev => ({
              ...prev,
              [slot]: prev[slot].filter((_, i) => i !== index)
            }));
          }}
        />
      )}
      
      {state === 'camera' && (
        <CameraCapture
          onCapture={handleCapture}
          onCancel={() => setState('inventory')}
        />
      )}
      
      {state === 'results' && buildMatches && (
        <BuildList
          matches={buildMatches}
          gear={gear}
          onBack={() => setState('inventory')}
        />
      )}
    </div>
  );
}
```

---

## Data Pipeline: Scraping Maxroll Builds

### Option 1: Fork D4LF Importer (Recommended)

D4LF already has working Maxroll import code. Adapt their `src/gui/importer/maxroll.py` to:
1. Fetch build guide pages
2. Extract gear requirements per slot
3. Output our build JSON format

### Option 2: Manual Curation (MVP)

For MVP, manually create 3-5 build JSON files per class by reading Maxroll guides. This is faster to start and ensures quality.

### Build Scraper Script (Python)

```python
# scripts/scrape_maxroll.py
import requests
from bs4 import BeautifulSoup
import json
import re

def scrape_build(url: str) -> dict:
    """
    Scrape a Maxroll build guide and extract gear requirements.
    Note: This is a starting point - Maxroll's structure may require adjustments.
    """
    response = requests.get(url)
    soup = BeautifulSoup(response.content, 'html.parser')
    
    # Extract build metadata
    title = soup.find('h1').text.strip()
    
    # Find gear section - structure varies by guide
    # This will need customization based on actual page structure
    gear_section = soup.find('div', {'class': 'gear-section'})
    
    build = {
        'id': slugify(title),
        'name': title,
        'source_url': url,
        'gear': {}
    }
    
    # Parse each gear slot
    # Implementation depends on Maxroll's HTML structure
    
    return build

def slugify(text: str) -> str:
    return re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')

# Usage
if __name__ == '__main__':
    builds = [
        'https://maxroll.gg/d4/build-guides/blessed-hammer-paladin-guide',
        # Add more URLs
    ]
    
    for url in builds:
        build = scrape_build(url)
        filename = f"data/builds/paladin/{build['id']}.json"
        with open(filename, 'w') as f:
            json.dump(build, f, indent=2)
```

---

## Deployment

### Hosting: Cloudflare Pages + Workers

**Why Cloudflare:**
- Unlimited bandwidth on free tier
- Workers run on edge (fast, no cold starts)
- 100K worker requests/day free
- Simple deployment via Git integration

### Project Structure for Cloudflare

```
/d4-build-matcher
  /src                    # React frontend
  /functions              # Cloudflare Workers (auto-deployed)
    /api
      parse-item.ts       # POST /api/parse-item
      match-builds.ts     # POST /api/match-builds
  /public
    /data                 # Static JSON (affixes, builds)
  wrangler.toml           # Cloudflare config
  package.json
```

### wrangler.toml

```toml
name = "d4-build-matcher"
compatibility_date = "2024-12-01"

[vars]
ENVIRONMENT = "production"

# Secrets (set via `wrangler secret put`)
# ANTHROPIC_API_KEY
# SUPABASE_URL  
# SUPABASE_ANON_KEY
```

### Worker Example: /functions/api/parse-item.ts

```typescript
import Anthropic from '@anthropic-ai/sdk';

interface Env {
  ANTHROPIC_API_KEY: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { image, playerClass } = await context.request.json();
  
  const anthropic = new Anthropic({
    apiKey: context.env.ANTHROPIC_API_KEY,
  });

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/jpeg",
              data: image,
            },
          },
          {
            type: "text",
            text: PARSE_PROMPT  // See full prompt in API section
          }
        ],
      }
    ],
  });

  const jsonText = response.content[0].type === 'text' ? response.content[0].text : '';
  const cleanJson = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  
  return new Response(JSON.stringify({
    success: true,
    item: JSON.parse(cleanJson)
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
};
```

### Deployment Commands

```bash
# Install Wrangler CLI
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Set secrets
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_ANON_KEY

# Deploy (or connect Git repo for auto-deploy)
wrangler pages deploy ./dist
```

### Environment Variables

Set these as secrets in Cloudflare dashboard or via Wrangler CLI:

```
ANTHROPIC_API_KEY=sk-ant-...
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
```

### Supabase Setup

1. Create new Supabase project
2. Run SQL to create tables (see Data Models section)
3. Enable anonymous auth for MVP (or add proper auth later)
4. Set up Row Level Security if storing user data

### Alternative: Cloudflare D1 (Optional)

If you want to stay fully in Cloudflare's ecosystem, you can use D1 (their SQLite database) instead of Supabase:

```toml
# wrangler.toml
[[d1_databases]]
binding = "DB"
database_name = "d4-build-matcher"
database_id = "xxxxx"
```

D1 is simpler but less feature-rich than Supabase. Supabase is recommended for MVP since you're already familiar with it.

---

## MVP Scope (Phase 1)

### In Scope
- [ ] Paladin class only
- [ ] 5 top Maxroll Paladin builds (manually curated)
- [ ] Camera capture on mobile
- [ ] Claude Vision API for parsing
- [ ] Basic build matching algorithm
- [ ] Results page with top 3 matches
- [ ] Mobile-responsive UI

### Out of Scope (Phase 2+)
- All 7 classes
- Automated Maxroll scraping
- User accounts / saved gear
- Desktop capture app
- Build comparison features
- Paragon board matching
- Skill tree recommendations

---

## Cost Estimates

### Claude Vision API (Haiku)
- ~$0.001-0.002 per image with Haiku
- 10 items scanned per session = ~$0.015
- **1,000 users × 10 scans = ~$15-20/month**

### Scaling Estimates
| Monthly Users | Scans/User | API Cost |
|---------------|------------|----------|
| 100           | 10         | ~$2      |
| 1,000         | 10         | ~$15-20  |
| 10,000        | 10         | ~$150-200|

### Supabase
- Free tier: 500MB database, 2GB bandwidth
- Sufficient for MVP and early growth

### Cloudflare (Pages + Workers)
- Free tier: Unlimited bandwidth, 100K worker requests/day
- Sufficient for MVP and significant scale

**Total MVP cost: ~$15-30/month** at moderate usage (1,000 users)

### Cost Optimization Options (if needed later)
1. **Self-host OCR**: Use d4-item-tooltip-ocr (PaddleOCR) on a $5-20/month VPS for unlimited parses
2. **Client-side OCR**: Tesseract.js in browser (free, less accurate)
3. **Caching**: Cache parsed results by image hash to avoid re-parsing identical items
4. **Rate limiting**: Limit scans per user per day on free tier

---

## Future Enhancements

1. **Auto-capture**: Detect tooltip borders and capture automatically
2. **Batch scanning**: Scan multiple items without returning to inventory view
3. **Build comparison**: Side-by-side compare two builds
4. **Upgrade advisor**: "If you find X, your match % goes to Y"
5. **Community builds**: Let users submit/rate builds
6. **Notifications**: Alert when a build you're targeting gets updated
7. **Export**: Share your gear profile or results

---

## Development Phases

### Week 1: Foundation
- [ ] Set up React project with Tailwind
- [ ] Create static JSON data files (affixes, 5 Paladin builds)
- [ ] Implement camera capture component
- [ ] Build Claude Vision integration for parsing

### Week 2: Core Features
- [ ] Gear inventory state management
- [ ] Build matching algorithm
- [ ] Results display UI
- [ ] Mobile responsive polish

### Week 3: Polish & Launch
- [ ] Error handling and edge cases
- [ ] Loading states and feedback
- [ ] Testing with real D4 screenshots
- [ ] Deploy to Cloudflare Pages
- [ ] Basic analytics

---

## Testing Checklist

### Image Parsing
- [ ] Clear, direct screenshot
- [ ] Phone photo of monitor (angled)
- [ ] Phone photo of TV (with glare)
- [ ] Low light conditions
- [ ] Different item types (weapon, armor, jewelry)
- [ ] Unique items vs legendaries
- [ ] Items with greater affixes
- [ ] Items with tempered affixes

### Build Matching
- [ ] User has BiS unique → high match
- [ ] User has no uniques → still suggests builds
- [ ] Multiple items per slot → picks best
- [ ] Empty slots handled gracefully
- [ ] Edge case: 0 items scanned

---

## Resources

### Data Sources
- D4LF: https://github.com/d4lfteam/d4lf (affixes, aspects, uniques JSON)
- DiabloTools: https://github.com/DiabloTools/d4data (datamined game data)
- Maxroll: https://maxroll.gg/d4/build-guides (build information)

### Reference Implementations
- D4LF Maxroll importer: `src/gui/importer/maxroll.py`
- d4-item-tooltip-ocr: https://github.com/mxtsdev/d4-item-tooltip-ocr
- Diablo4Companion: https://github.com/josdemmers/Diablo4Companion

---

## License Considerations

- D4LF is open source (check license for data reuse)
- Maxroll data should be scraped responsibly, consider reaching out
- Blizzard's game data terms apply to any datamined content
- Your tool should be free to avoid commercial use complications
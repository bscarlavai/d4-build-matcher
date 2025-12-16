#!/usr/bin/env python3
"""
Sync Maxroll builds to local JSON files.

Usage:
    python scripts/sync_maxroll_builds.py

This script:
1. Fetches build guide pages from Maxroll
2. Extracts planner IDs from embedded data
3. Fetches build data from Maxroll's planner API
4. Transforms to our JSON format
5. Writes to public/data/builds/{class}/
"""

import json
import os
import re
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

import requests
from lxml import html

# Maxroll API endpoints
PLANNER_API = "https://planners.maxroll.gg/profiles/d4/{planner_id}"
MAPPING_DATA_URL = "https://assets-ng.maxroll.gg/d4-tools/game/data.min.json"

# Tierlist URLs by class (for fetching build tiers)
TIERLIST_URLS = {
    "paladin": "https://maxroll.gg/d4/tierlists/paladin-endgame-tier-list",
    "barbarian": "https://maxroll.gg/d4/tierlists/barbarian-endgame-tier-list",
    "druid": "https://maxroll.gg/d4/tierlists/druid-endgame-tier-list",
    "necromancer": "https://maxroll.gg/d4/tierlists/necromancer-endgame-tier-list",
    "rogue": "https://maxroll.gg/d4/tierlists/rogue-endgame-tier-list",
    "sorcerer": "https://maxroll.gg/d4/tierlists/sorcerer-endgame-tier-list",
    "spiritborn": "https://maxroll.gg/d4/tierlists/spiritborn-endgame-tier-list",
}

# Slot ID mapping from Maxroll numeric IDs to our format
# Derived from observing the API data
SLOT_ID_MAPPING = {
    "4": "helm",
    "5": "chest",
    "6": "chest",  # alt chest?
    "8": "weapon",   # 2H weapon slot 1
    "9": "weapon",   # 2H weapon slot 2 / offhand
    "10": "offhand",
    "11": "weapon",  # 1H weapon
    "12": "offhand", # 1H offhand
    "13": "gloves",
    "14": "pants",
    "15": "boots",
    "16": "ring",    # ring 1
    "17": "ring",    # ring 2
    "18": "amulet",
}

# Item type prefix to slot mapping (fallback)
ITEM_TYPE_TO_SLOT = {
    "helm": "helm",
    "chest": "chest",
    "gloves": "gloves",
    "pants": "pants",
    "boots": "boots",
    "amulet": "amulet",
    "ring": "ring",
    "1hsword": "weapon",
    "1hmace": "weapon",
    "1haxe": "weapon",
    "dagger": "weapon",
    "wand": "weapon",
    "2hsword": "weapon",
    "2hmace": "weapon",
    "2haxe": "weapon",
    "2hpolearm": "weapon",
    "2hscythe": "weapon",
    "staff": "weapon",
    "bow": "weapon",
    "crossbow": "weapon",
    "1hflail": "weapon",
    "2hflail": "weapon",
    "flail": "weapon",
    "focus": "offhand",
    "shield": "offhand",
    "totem": "offhand",
}

# Manual name mappings for new items not yet in Maxroll's database
# Source: Wowhead Diablo 4 database (https://www.wowhead.com/diablo-4/items)
# Format: "internal_id": "Human Readable Name"
NEW_ITEM_NAMES = {
    # Paladin Swords
    "1hsword_unique_paladin_001": "Supplication",
    "1hsword_unique_paladin_002": "Griswold's Opus",
    "2hsword_unique_paladin_002": "Red Sermon",
    # Paladin Shields
    "1hshield_unique_paladin_001": "Gate of the Red Dawn",
    "1hshield_unique_paladin_002": "Bastion of Sir Matthias",
    "1hshield_unique_paladin_003": "Ward of the White Dove",
    "1hshield_unique_paladin_004": "Herald of Zakarum",
    "1hshield_unique_paladin_005": "Cathedral's Song",
    # Paladin Flails
    "1hflail_unique_paladin_003": "Light's Rebuke",
    "1hflail_unique_paladin_004": "Sunbrand",
    # Paladin Maces
    "1hmace_unique_paladin_001": "Herald's Morningstar",
    # Paladin Axes
    "2haxe_unique_paladin_001": "Sundered Night",
    # Paladin Armor
    "helm_unique_paladin_002": "Judicant's Glaivehelm",
    "chest_unique_paladin_001": "Mantle of the Grey",
    "gloves_unique_paladin_003": "Dawnfire",
    "pants_unique_paladin_002": "Arcadia",
    "boots_unique_paladin_001": "March of the Stalwart Soul",
    # Paladin Jewelry
    "ring_unique_paladin_001": "Argent Veil",
    "ring_unique_paladin_002": "Seal of the Second Trumpet",
    "ring_unique_paladin_003": "Wreath of Auric Laurel",
    "amulet_unique_paladin_002": "Sanctis of Kethamar",
    "amulet_unique_paladin_003": "Judgment of Auriel",
}

# Cache for mapping data
_mapping_data_cache = None
_affix_id_lookup = None


def get_with_retry(url: str, max_retries: int = 3, delay: float = 1.0) -> requests.Response:
    """Fetch URL with retry logic."""
    for attempt in range(max_retries):
        try:
            response = requests.get(url, timeout=30)
            response.raise_for_status()
            return response
        except requests.RequestException as e:
            if attempt == max_retries - 1:
                raise
            print(f"  Retry {attempt + 1}/{max_retries} for {url}: {e}")
            time.sleep(delay * (attempt + 1))
    raise RuntimeError(f"Failed to fetch {url}")


def get_mapping_data() -> dict:
    """Fetch and cache the Maxroll mapping data."""
    global _mapping_data_cache
    if _mapping_data_cache is None:
        print("Fetching Maxroll mapping data...")
        response = get_with_retry(MAPPING_DATA_URL)
        _mapping_data_cache = response.json()
    return _mapping_data_cache


def get_affix_id_lookup(mapping_data: dict) -> dict:
    """Build and cache a reverse lookup from numeric affix ID to affix data."""
    global _affix_id_lookup
    if _affix_id_lookup is None:
        _affix_id_lookup = {}
        affixes = mapping_data.get("affixes", {})
        for name, affix_data in affixes.items():
            affix_id = affix_data.get("id")
            if affix_id:
                _affix_id_lookup[affix_id] = {"name": name, **affix_data}
        print(f"  Built affix ID lookup with {len(_affix_id_lookup)} entries")
    return _affix_id_lookup


def fetch_tier_mapping(player_class: str) -> Tuple[Dict[str, str], List[str]]:
    """
    Fetch build tiers from Maxroll tierlist page.
    Returns (tier_mapping, build_urls) where:
    - tier_mapping: build guide URL -> tier (S, A, B, etc.)
    - build_urls: list of all build guide URLs found
    """
    tierlist_url = TIERLIST_URLS.get(player_class)
    if not tierlist_url:
        return {}, []

    try:
        print(f"  Fetching tierlist: {tierlist_url}")
        response = get_with_retry(tierlist_url)
        html_text = response.text

        # Extract Remix context data
        remix_match = re.search(
            r'window\.__remixContext\s*=\s*(\{.+?\});?\s*</script>',
            html_text,
            re.DOTALL
        )
        if not remix_match:
            print("  Warning: Could not find tierlist data")
            return {}, []

        data = json.loads(remix_match.group(1))
        loader_data = data.get("state", {}).get("loaderData", {})

        # Find the post with tierlist block
        tier_mapping = {}
        build_urls = []
        for route_data in loader_data.values():
            if not isinstance(route_data, dict) or "post" not in route_data:
                continue

            post = route_data["post"]
            gutenberg = post.get("gutenbergBlock", [])

            # Recursively find tierlist blocks
            def extract_tiers(obj: Any) -> None:
                if isinstance(obj, dict):
                    if obj.get("blockName") in ("flavor/tierlist", "maxroll/tierlist"):
                        items = obj.get("attributes", {}).get("items", [])
                        for item in items:
                            link = item.get("link", "")
                            tier = item.get("tier", "")
                            if link:
                                build_urls.append(link)
                                if tier:
                                    tier_mapping[link] = tier
                    for v in obj.values():
                        extract_tiers(v)
                elif isinstance(obj, list):
                    for item in obj:
                        extract_tiers(item)

            extract_tiers(gutenberg)

        print(f"  Found {len(build_urls)} builds ({len(tier_mapping)} with tiers)")
        return tier_mapping, build_urls

    except Exception as e:
        print(f"  Warning: Failed to fetch tierlist: {e}")
        return {}, []


def extract_planner_id_from_guide(url: str) -> Tuple[str, Optional[str]]:
    """
    Extract planner ID and profile ID from a Maxroll build guide URL.
    Returns (planner_id, profile_id).
    """
    print(f"  Fetching guide page: {url}")
    response = get_with_retry(url)
    tree = html.fromstring(response.content)

    # Find the d4-embed element
    embeds = tree.xpath("//*[contains(@class, 'd4-embed')]")
    if not embeds:
        raise ValueError(f"No d4-embed found in {url}")

    embed = embeds[0]
    planner_id = embed.get("data-d4-profile")
    profile_id = embed.get("data-d4-id") or embed.get("data-d4-data")

    if not planner_id:
        raise ValueError(f"No planner ID found in {url}")

    return planner_id, profile_id


def fetch_planner_data(planner_id: str) -> dict:
    """Fetch build data from Maxroll planner API."""
    url = PLANNER_API.format(planner_id=planner_id)
    print(f"  Fetching planner data: {planner_id}")
    response = get_with_retry(url)
    return response.json()


def resolve_affix_name(affix_id: int, mapping_data: dict) -> Optional[str]:
    """Resolve a numeric affix ID to a normalized name."""
    # Use the reverse lookup by numeric ID
    affix_lookup = get_affix_id_lookup(mapping_data)
    affix_data = affix_lookup.get(affix_id)

    if not affix_data:
        return None

    # The internal name is stored in "name" key (e.g., "S04_CooldownReductionCDR")
    internal_name = affix_data.get("name", "")

    # Try to get a more readable name from prefix/suffix
    prefix = affix_data.get("prefix", "")
    suffix = affix_data.get("suffix", "")

    # Use suffix without "of " prefix as it's more descriptive
    if suffix and suffix.startswith("of "):
        readable_name = suffix[3:]  # Remove "of " prefix
        return normalize_affix_name(readable_name)
    elif prefix:
        return normalize_affix_name(prefix)
    elif internal_name:
        # Fallback to internal name, cleaned up
        # Remove S04_ prefix and other version markers
        clean_name = re.sub(r'^S\d+_', '', internal_name)
        return normalize_affix_name(clean_name)

    return None


def normalize_affix_name(name: str) -> str:
    """Normalize an affix name to lowercase_with_underscores."""
    # Remove brackets and special chars
    name = re.sub(r'\[.*?\]', '', name)
    name = re.sub(r'[^\w\s]', '', name)
    # Convert to lowercase with underscores
    name = name.strip().lower()
    name = re.sub(r'\s+', '_', name)
    return name


def resolve_item_type(item_data: dict, mapping_data: dict) -> Optional[str]:
    """Resolve item type from item data."""
    items_db = mapping_data.get("items", {})
    item_id = item_data.get("id")

    if item_id:
        item_info = items_db.get(str(item_id), {})
        item_type = item_info.get("t") or item_info.get("type", "")
        return item_type.lower() if item_type else None

    return None


def resolve_unique_name(item_data: dict, mapping_data: dict) -> Optional[str]:
    """Resolve unique item name from item data."""
    items_db = mapping_data.get("items", {})
    item_id = item_data.get("id")

    if item_id:
        item_info = items_db.get(str(item_id), {})
        name = item_info.get("n") or item_info.get("name", "")
        if name:
            return normalize_affix_name(name)

    return None


def resolve_aspect_name(aspect_id: str, mapping_data: dict) -> Optional[str]:
    """Resolve aspect name from ID."""
    aspects = mapping_data.get("legendaryPowers", {}) or mapping_data.get("aspects", {})
    aspect_data = aspects.get(str(aspect_id), {})
    name = aspect_data.get("n") or aspect_data.get("name", "")

    if name:
        return normalize_affix_name(name)

    return None


def get_slot_from_item_id(item_id_str: str) -> Optional[str]:
    """Determine slot from item ID string (e.g., 'Helm_Unique_Barb_101')."""
    item_id_lower = item_id_str.lower()
    for prefix, slot in ITEM_TYPE_TO_SLOT.items():
        if item_id_lower.startswith(prefix):
            return slot
    return None


def resolve_unique_item_name(item_id: str, mapping_data: dict) -> str:
    """Resolve a unique item ID to its human-readable name."""
    items_db = mapping_data.get("items", {})

    # Try exact match in database first
    if item_id in items_db:
        return items_db[item_id].get("name", item_id)

    # Try case-insensitive match in database
    item_id_lower = item_id.lower()
    for key, item_data in items_db.items():
        if key.lower() == item_id_lower:
            return item_data.get("name", item_id)

    # Try matching without s10/s11 prefix
    clean_id = re.sub(r'^s\d+_', '', item_id, flags=re.IGNORECASE)
    if clean_id in items_db:
        return items_db[clean_id].get("name", item_id)

    for key, item_data in items_db.items():
        if key.lower() == clean_id.lower():
            return item_data.get("name", item_id)

    # Check manual NEW_ITEM_NAMES mapping
    clean_id_lower = clean_id.lower()
    # Try exact match first
    if clean_id_lower in NEW_ITEM_NAMES:
        return NEW_ITEM_NAMES[clean_id_lower]
    # Try without trailing numbers (e.g., _001, _002)
    base_id = re.sub(r'_\d+$', '', clean_id_lower)
    if base_id in NEW_ITEM_NAMES:
        return NEW_ITEM_NAMES[base_id]
    # Try partial match (for generic patterns)
    for pattern, name in NEW_ITEM_NAMES.items():
        if pattern in clean_id_lower:
            return name

    # Fallback: clean up the ID for display
    # Remove numeric suffixes and clean up
    fallback = re.sub(r'_?\d+$', '', clean_id)  # Remove trailing numbers
    fallback = re.sub(r'^(s\d+_)?', '', fallback, flags=re.IGNORECASE)  # Remove season prefix
    # Remove weapon type prefixes before converting to title case
    fallback = re.sub(r'^(1h|2h)', '', fallback, flags=re.IGNORECASE)
    fallback = fallback.replace("_", " ").title()
    fallback = re.sub(r'\s+', ' ', fallback).strip()
    return fallback if fallback else clean_id.replace("_", " ").title()


def extract_build_name_from_url(url: str) -> str:
    """Extract a clean build name from the guide URL."""
    # URL like: https://maxroll.gg/d4/build-guides/blessed-hammer-paladin-guide
    path = url.rstrip("/").split("/")[-1]

    # Remove -guide suffix
    if path.endswith("-guide"):
        path = path[:-6]

    # Convert to title case
    name = path.replace("-", " ").title()

    return name


def extract_gear_from_profile(
    profile: dict,
    items_db: dict,
    mapping_data: dict
) -> dict:
    """Extract gear requirements from a single profile."""
    gear = {}
    profile_items = profile.get("items", {})

    for slot_id, item_ref in profile_items.items():
        # Get slot from slot ID mapping, or from item type
        slot = SLOT_ID_MAPPING.get(str(slot_id))

        # Get item data
        item_data = items_db.get(str(item_ref), {})
        if not item_data:
            continue

        # If slot not found from ID, try to infer from item name
        if not slot:
            item_id_str = item_data.get("id", "")
            slot = get_slot_from_item_id(item_id_str)
            if not slot:
                continue

        if slot not in gear:
            gear[slot] = {
                "slot": slot,
                "priority_uniques": [],
                "priority_aspects": [],
                "priority_affixes": [],
                "required_tempers": [],
            }

        # Check if it's a unique (item ID contains "Unique")
        item_id_str = item_data.get("id", "")
        is_unique = "unique" in item_id_str.lower()

        if is_unique:
            # Get human-readable name for the unique item
            unique_name = resolve_unique_item_name(item_id_str, mapping_data)
            if unique_name and unique_name not in gear[slot]["priority_uniques"]:
                gear[slot]["priority_uniques"].append(unique_name)

        # Extract aspects from legendaryPower
        legendary_power = item_data.get("legendaryPower", {})
        if legendary_power:
            aspect_id = legendary_power.get("nid")
            if aspect_id:
                aspect_name = resolve_aspect_name(aspect_id, mapping_data)
                if aspect_name and aspect_name not in gear[slot]["priority_aspects"]:
                    gear[slot]["priority_aspects"].append(aspect_name)

        # Extract affixes (skip unique item powers which pollute the affix list)
        explicits = item_data.get("explicits", [])
        for i, affix in enumerate(explicits):
            affix_id = affix.get("nid")
            if affix_id:
                affix_name = resolve_affix_name(affix_id, mapping_data)
                if affix_name:
                    # Skip unique item powers - they're not regular affixes
                    if "_unique_" in affix_name or "uberunique_" in affix_name:
                        continue
                    # Weight decreases by position (first affix = most important)
                    weight = max(10 - i * 2, 3)
                    existing = next(
                        (a for a in gear[slot]["priority_affixes"] if a["name"] == affix_name),
                        None
                    )
                    if not existing:
                        gear[slot]["priority_affixes"].append({
                            "name": affix_name,
                            "weight": weight,
                        })

    return gear


# Standard profile names we want to extract (in order of progression)
STANDARD_PROFILES = ["starter", "ancestral", "mythic"]


def normalize_profile_name(name: str) -> Tuple[str, str]:
    """
    Normalize profile name to our standard names.
    Returns (normalized_key, display_name).
    """
    name_lower = name.lower().strip()

    # Map common variations to standard names
    if "starter" in name_lower or "leveling" in name_lower:
        return ("starter", "Starter")
    elif "ancestral" in name_lower:
        return ("ancestral", "Ancestral")
    elif "mythic" in name_lower or "bis" in name_lower or "endgame" in name_lower:
        return ("mythic", "Mythic")
    elif "sanctif" in name_lower:
        return ("sanctified", "Sanctified")
    elif "push" in name_lower:
        return ("push", "Push")

    # Return cleaned up version if no match
    clean_name = name.strip()
    # Remove parentheses and their contents
    clean_name = re.sub(r'\([^)]*\)', '', clean_name).strip()
    if not clean_name:
        clean_name = name.strip()
    key = name_lower.replace(" ", "_").replace("(", "").replace(")", "")
    return (key, clean_name.title() if clean_name else name)


def transform_to_build_json(
    planner_data: dict,
    profile_id: Optional[str],
    source_url: str,
    mapping_data: dict,
    tier: str = "Unknown",
    category: str = "endgame"
) -> dict:
    """Transform Maxroll planner data to our build JSON format with all profiles."""

    # Parse the nested data JSON
    data_str = planner_data.get("data", "{}")
    try:
        data = json.loads(data_str) if isinstance(data_str, str) else data_str
    except json.JSONDecodeError:
        data = {}

    items_db = data.get("items", {})
    profiles_list = data.get("profiles", [])
    player_class = planner_data.get("class", "unknown").lower()

    # Extract gear from ALL profiles
    profiles = {}
    profile_order = []

    for profile in profiles_list:
        profile_name = profile.get("name", "Unknown")
        normalized_key, display_name = normalize_profile_name(profile_name)

        # Skip duplicate normalized names (keep first occurrence)
        if normalized_key in profiles:
            continue

        gear = extract_gear_from_profile(profile, items_db, mapping_data)

        # Only include profiles that have gear
        if gear:
            profiles[normalized_key] = {
                "name": display_name,  # Clean display name
                "gear": gear,
            }
            profile_order.append(normalized_key)

    # Sort profiles in standard order (starter, ancestral, mythic, then others)
    def profile_sort_key(name: str) -> int:
        try:
            return STANDARD_PROFILES.index(name)
        except ValueError:
            return len(STANDARD_PROFILES)  # Put non-standard profiles at the end

    profile_order.sort(key=profile_sort_key)

    # Extract clean build name from URL (more reliable than planner names)
    build_name = extract_build_name_from_url(source_url)

    # Generate build ID from URL slug
    url_slug = source_url.rstrip("/").split("/")[-1]
    if url_slug.endswith("-guide"):
        url_slug = url_slug[:-6]
    build_id = url_slug

    return {
        "id": build_id,
        "name": build_name,
        "class": player_class,
        "category": category,
        "source_url": source_url,
        "tier": tier,
        "tags": [],
        "last_updated": time.strftime("%Y-%m-%d"),
        "profile_order": profile_order,
        "profiles": profiles,
    }


def sync_build(url: str, output_dir: Path, mapping_data: dict, tier_mapping: Dict[str, str]) -> Optional[dict]:
    """Sync a single build from Maxroll."""
    try:
        print(f"\nProcessing: {url}")

        # Extract planner ID
        planner_id, profile_id = extract_planner_id_from_guide(url)

        # Fetch planner data
        planner_data = fetch_planner_data(planner_id)

        # Look up tier from tierlist
        tier = tier_mapping.get(url, "Unknown")
        print(f"  Tier: {tier}")

        # Transform to our format
        build = transform_to_build_json(planner_data, profile_id, url, mapping_data, tier)

        # Write to file
        player_class = build["class"]
        build_id = build["id"]

        class_dir = output_dir / player_class
        class_dir.mkdir(parents=True, exist_ok=True)

        output_file = class_dir / f"{build_id}.json"
        with open(output_file, "w") as f:
            json.dump(build, f, indent=2)

        print(f"  Wrote: {output_file}")
        return build

    except Exception as e:
        print(f"  ERROR: {e}")
        return None


def update_index(output_dir: Path, player_class: str, builds: List[dict]):
    """Update the index.json for a class."""
    class_dir = output_dir / player_class
    index_file = class_dir / "index.json"

    index = {
        "class": player_class,
        "builds": [
            {
                "id": b["id"],
                "name": b["name"],
                "tier": b["tier"],
                "file": f"{b['id']}.json",
            }
            for b in builds
        ],
    }

    with open(index_file, "w") as f:
        json.dump(index, f, indent=2)

    print(f"Updated index: {index_file}")


def main():
    """Main entry point."""
    # Determine output directory
    script_dir = Path(__file__).parent
    project_root = script_dir.parent
    output_dir = project_root / "public" / "data" / "builds" / "endgame"

    print(f"Output directory: {output_dir}")

    # Fetch mapping data once
    mapping_data = get_mapping_data()

    # Process each class (auto-discover builds from tierlists)
    classes = list(TIERLIST_URLS.keys())
    for player_class in classes:
        print(f"\n{'=' * 60}")
        print(f"Processing {player_class} builds...")
        print('=' * 60)

        # Fetch tier mapping and build URLs for this class
        tier_mapping, urls = fetch_tier_mapping(player_class)

        if not urls:
            print(f"  No builds found for {player_class}")
            continue

        builds = []
        for url in urls:
            build = sync_build(url, output_dir, mapping_data, tier_mapping)
            if build:
                builds.append(build)
            time.sleep(0.5)  # Rate limiting

        if builds:
            update_index(output_dir, player_class, builds)

    print("\n" + "=" * 60)
    print("Sync complete!")
    print("=" * 60)


if __name__ == "__main__":
    main()

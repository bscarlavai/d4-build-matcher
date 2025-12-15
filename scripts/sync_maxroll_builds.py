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

# Build guide URLs to sync (organized by class)
# TODO: Could scrape https://maxroll.gg/d4/build-guides to get this list automatically
BUILD_GUIDES = {
    "paladin": [
        "https://maxroll.gg/d4/build-guides/wing-strikes-paladin-guide",
        "https://maxroll.gg/d4/build-guides/blessed-hammer-paladin-guide",
    ],
    "barbarian": [
        "https://maxroll.gg/d4/build-guides/bash-barbarian-guide",
        "https://maxroll.gg/d4/build-guides/double-swing-barbarian-guide",
        "https://maxroll.gg/d4/build-guides/whirlwind-barbarian-guide",
    ],
    "druid": [
        "https://maxroll.gg/d4/build-guides/pulverize-druid-guide",
        "https://maxroll.gg/d4/build-guides/tornado-druid-guide",
    ],
    "necromancer": [
        "https://maxroll.gg/d4/build-guides/minion-necromancer-guide",
        "https://maxroll.gg/d4/build-guides/bone-spear-necromancer-guide",
    ],
    "rogue": [
        "https://maxroll.gg/d4/build-guides/barrage-rogue-guide",
        "https://maxroll.gg/d4/build-guides/twisting-blades-rogue-guide",
    ],
    "sorcerer": [
        "https://maxroll.gg/d4/build-guides/frozen-orb-sorcerer-guide",
        "https://maxroll.gg/d4/build-guides/ball-lightning-sorcerer-guide",
    ],
    "spiritborn": [
        "https://maxroll.gg/d4/build-guides/quill-volley-spiritborn-guide",
        "https://maxroll.gg/d4/build-guides/evade-spiritborn-guide",
    ],
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
    "focus": "offhand",
    "shield": "offhand",
    "totem": "offhand",
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


def transform_to_build_json(
    planner_data: dict,
    profile_id: Optional[str],
    source_url: str,
    mapping_data: dict
) -> dict:
    """Transform Maxroll planner data to our build JSON format."""

    # Parse the nested data JSON
    data_str = planner_data.get("data", "{}")
    try:
        data = json.loads(data_str) if isinstance(data_str, str) else data_str
    except json.JSONDecodeError:
        data = {}

    items = data.get("items", {})
    profiles = data.get("profiles", [])  # profiles is a list!
    active_profile_idx = data.get("activeProfile", 0)

    # Find the active profile
    if isinstance(profiles, list) and profiles:
        # Use activeProfile index, or profile_id if provided
        if profile_id and profile_id.isdigit():
            idx = int(profile_id)
            profile = profiles[idx] if idx < len(profiles) else profiles[0]
        elif active_profile_idx < len(profiles):
            profile = profiles[active_profile_idx]
        else:
            profile = profiles[0]
    else:
        profile = {"items": {}}

    profile_name = profile.get("name", planner_data.get("name", "Unknown Build"))
    player_class = planner_data.get("class", "unknown").lower()

    # Build the gear requirements
    gear = {}
    profile_items = profile.get("items", {})

    for slot_id, item_ref in profile_items.items():
        # Get slot from slot ID mapping, or from item type
        slot = SLOT_ID_MAPPING.get(str(slot_id))

        # Get item data
        item_data = items.get(str(item_ref), {})
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
            unique_name = normalize_affix_name(item_id_str)
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

    # Use the planner name for build name (more descriptive than profile name)
    build_name = planner_data.get("name", profile_name)

    # Generate build ID from name
    build_id = normalize_affix_name(build_name)
    if not build_id.endswith(player_class):
        build_id = f"{build_id}-{player_class}"

    # Determine tier (placeholder - would need to scrape from guide page)
    tier = "A"

    return {
        "id": build_id,
        "name": build_name,
        "class": player_class,
        "source_url": source_url,
        "tier": tier,
        "tags": [],
        "last_updated": time.strftime("%Y-%m-%d"),
        "gear": gear,
    }


def sync_build(url: str, output_dir: Path, mapping_data: dict) -> Optional[dict]:
    """Sync a single build from Maxroll."""
    try:
        print(f"\nProcessing: {url}")

        # Extract planner ID
        planner_id, profile_id = extract_planner_id_from_guide(url)

        # Fetch planner data
        planner_data = fetch_planner_data(planner_id)

        # Transform to our format
        build = transform_to_build_json(planner_data, profile_id, url, mapping_data)

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
    output_dir = project_root / "public" / "data" / "builds"

    print(f"Output directory: {output_dir}")

    # Fetch mapping data once
    mapping_data = get_mapping_data()

    # Process each class
    for player_class, urls in BUILD_GUIDES.items():
        if not urls:
            print(f"\nSkipping {player_class} (no URLs configured)")
            continue

        print(f"\n{'=' * 60}")
        print(f"Processing {player_class} builds...")
        print('=' * 60)

        builds = []
        for url in urls:
            build = sync_build(url, output_dir, mapping_data)
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

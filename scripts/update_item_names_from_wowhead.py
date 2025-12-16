#!/usr/bin/env python3
"""
Utility script to fetch item names from Wowhead and update NEW_ITEM_NAMES in sync_maxroll_builds.py.

Usage:
    python scripts/update_item_names_from_wowhead.py

This script:
1. Fetches all unique items for a class from Wowhead
2. Extracts internal IDs and display names
3. Outputs the mappings in a format ready to paste into sync_maxroll_builds.py

Note: Wowhead class IDs:
    - Barbarian: 1
    - Druid: 2
    - Necromancer: 3
    - Rogue: 4
    - Sorcerer: 5
    - Spiritborn: 6
    - Paladin: 7
"""

import re
import sys
import time
import requests
from bs4 import BeautifulSoup
from typing import Dict, Optional

# Wowhead class IDs
CLASS_IDS = {
    "barbarian": 1,
    "druid": 2,
    "necromancer": 3,
    "rogue": 4,
    "sorcerer": 5,
    "spiritborn": 6,
    "paladin": 7,
}

# Quality IDs: 5 = Unique, 6 = Mythic
QUALITY_UNIQUE = 5
QUALITY_MYTHIC = 6


def fetch_item_list(class_id: int, quality: int = QUALITY_UNIQUE) -> list:
    """Fetch list of items from Wowhead for a given class and quality."""
    url = f"https://www.wowhead.com/diablo-4/items/class:{class_id}/quality:{quality}"
    print(f"Fetching item list from: {url}")

    response = requests.get(url, headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
    })
    response.raise_for_status()

    soup = BeautifulSoup(response.text, "html.parser")

    # Find all item links
    items = []
    for link in soup.find_all("a", href=re.compile(r"/diablo-4/item/\d+")):
        item_id = re.search(r"/diablo-4/item/(\d+)", link["href"])
        if item_id:
            name = link.get_text(strip=True)
            if name:  # Skip empty names
                items.append({
                    "wowhead_id": item_id.group(1),
                    "name": name,
                    "url": f"https://www.wowhead.com{link['href']}"
                })

    # Deduplicate by name
    seen = set()
    unique_items = []
    for item in items:
        if item["name"] not in seen:
            seen.add(item["name"])
            unique_items.append(item)

    return unique_items


def fetch_internal_id(wowhead_url: str) -> Optional[str]:
    """Fetch the internal game ID from a Wowhead item page."""
    print(f"  Fetching internal ID from: {wowhead_url}")

    response = requests.get(wowhead_url, headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
    })
    response.raise_for_status()

    soup = BeautifulSoup(response.text, "html.parser")

    # Look for the internal ID in the item tooltip/details
    # It appears in format like "1HSword_Unique_Paladin_002.itm"
    text = soup.get_text()

    # Remove zero-width spaces that Wowhead uses
    text = text.replace("\u200b", "")

    # Find patterns like "1HSword_Unique_Paladin_002.itm" or similar
    match = re.search(r'(\w+_Unique_\w+_\d+)\.itm', text, re.IGNORECASE)
    if match:
        return match.group(1).lower()

    # Try alternative pattern without .itm
    match = re.search(r'(\w+_Unique_\w+_\d+)', text, re.IGNORECASE)
    if match:
        return match.group(1).lower()

    return None


def fetch_all_item_mappings(class_name: str) -> Dict[str, str]:
    """Fetch all unique item mappings for a class."""
    class_id = CLASS_IDS.get(class_name.lower())
    if not class_id:
        print(f"Unknown class: {class_name}")
        print(f"Valid classes: {', '.join(CLASS_IDS.keys())}")
        sys.exit(1)

    print(f"\n=== Fetching {class_name.title()} Unique Items ===\n")

    # Fetch both unique and mythic quality items
    items = fetch_item_list(class_id, QUALITY_UNIQUE)
    mythic_items = fetch_item_list(class_id, QUALITY_MYTHIC)

    # Combine and deduplicate
    all_items = items + mythic_items
    seen = set()
    unique_items = []
    for item in all_items:
        if item["name"] not in seen:
            seen.add(item["name"])
            unique_items.append(item)

    print(f"Found {len(unique_items)} unique items for {class_name.title()}")

    mappings = {}
    for item in unique_items:
        # Rate limit to be nice to Wowhead
        time.sleep(0.5)

        internal_id = fetch_internal_id(item["url"])
        if internal_id:
            mappings[internal_id] = item["name"]
            print(f"    '{internal_id}': '{item['name']}'")
        else:
            print(f"    WARNING: Could not find internal ID for {item['name']}")

    return mappings


def generate_python_dict(mappings: Dict[str, str], class_name: str) -> str:
    """Generate Python dict code for the mappings."""
    lines = [f"    # {class_name.title()} Items (from Wowhead)"]

    # Group by item type
    categories = {}
    for internal_id, name in sorted(mappings.items()):
        # Extract item type from ID (e.g., "1hsword", "helm", "ring")
        match = re.match(r'(\w+?)_unique', internal_id, re.IGNORECASE)
        if match:
            item_type = match.group(1).lower()
        else:
            item_type = "other"

        if item_type not in categories:
            categories[item_type] = []
        categories[item_type].append((internal_id, name))

    # Output by category
    type_order = ["1hsword", "2hsword", "1hshield", "1hflail", "2hflail", "1hmace", "2hmace",
                  "1haxe", "2haxe", "dagger", "helm", "chest", "gloves", "pants", "boots",
                  "ring", "amulet"]

    for item_type in type_order:
        if item_type in categories:
            for internal_id, name in sorted(categories[item_type]):
                lines.append(f'    "{internal_id}": "{name}",')

    # Any remaining categories
    for item_type in sorted(categories.keys()):
        if item_type not in type_order:
            for internal_id, name in sorted(categories[item_type]):
                lines.append(f'    "{internal_id}": "{name}",')

    return "\n".join(lines)


def main():
    if len(sys.argv) < 2:
        print("Usage: python update_item_names_from_wowhead.py <class_name>")
        print(f"Valid classes: {', '.join(CLASS_IDS.keys())}")
        sys.exit(1)

    class_name = sys.argv[1].lower()

    mappings = fetch_all_item_mappings(class_name)

    print(f"\n\n=== Python Dict Output ===\n")
    print(generate_python_dict(mappings, class_name))
    print("\n=== End ===\n")
    print(f"Total items mapped: {len(mappings)}")


if __name__ == "__main__":
    main()

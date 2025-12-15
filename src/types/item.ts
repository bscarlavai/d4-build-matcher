export interface Affix {
  name: string;
  value: number;
}

export interface Aspect {
  name: string;
  description?: string;
  value: number;
}

export interface Item {
  name: string;
  type: ItemSlot;
  item_power: number;
  is_unique: boolean;
  unique_id: string | null;
  affixes: Affix[];
  tempered_affixes: Affix[];
  greater_affixes: string[];
  aspect: Aspect | null;
  sockets: { total: number; filled: number };
  class_restriction: string | null;
  source_image_url?: string;
}

export type ItemSlot =
  | 'helm'
  | 'chest'
  | 'gloves'
  | 'pants'
  | 'boots'
  | 'amulet'
  | 'ring'
  | 'weapon'
  | 'offhand';

export type PlayerClass =
  | 'barbarian'
  | 'druid'
  | 'necromancer'
  | 'rogue'
  | 'sorcerer'
  | 'spiritborn'
  | 'paladin';

export interface UserGear {
  [slot: string]: Item[];
}

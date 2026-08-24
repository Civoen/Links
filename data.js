// PLACEHOLDER DATA
// Modern Warfare 4 launches Oct 23, 2026 and its weapon roster / camo challenges
// haven't been revealed yet. Until they are, this tracker is seeded with the
// Black Ops 6 launch weapon list (33 weapons) purely as a stand-in structure.
// Swap WEAPONS and CAMO_TIERS below once real MW4 data is announced.

const WEAPONS = [
  // Assault Rifles
  { name: 'XM4', class: 'Assault Rifle' },
  { name: 'AK-74', class: 'Assault Rifle' },
  { name: 'AMES 85', class: 'Assault Rifle' },
  { name: 'GPR 91', class: 'Assault Rifle' },
  { name: 'Model L', class: 'Assault Rifle' },
  { name: 'Goblin Mk2', class: 'Assault Rifle' },
  { name: 'AS VAL', class: 'Assault Rifle' },
  // SMGs
  { name: 'C9', class: 'SMG' },
  { name: 'KSV', class: 'SMG' },
  { name: 'Tanto .22', class: 'SMG' },
  { name: 'PP-919', class: 'SMG' },
  { name: 'Jackal PDW', class: 'SMG' },
  { name: 'Kompakt 92', class: 'SMG' },
  // Shotguns
  { name: 'Marine SP', class: 'Shotgun' },
  { name: 'ASG-89', class: 'Shotgun' },
  // LMGs
  { name: 'XMG', class: 'LMG' },
  { name: 'PU-21', class: 'LMG' },
  { name: 'GPMG-7', class: 'LMG' },
  // Marksman Rifles
  { name: 'SWAT 5.56', class: 'Marksman Rifle' },
  { name: 'Tsarkov 7.62', class: 'Marksman Rifle' },
  { name: 'AEK-973', class: 'Marksman Rifle' },
  { name: 'DM-10', class: 'Marksman Rifle' },
  // Sniper Rifles
  { name: 'LW3A1 Frostline', class: 'Sniper Rifle' },
  { name: 'SVD', class: 'Sniper Rifle' },
  { name: 'LR 7.62', class: 'Sniper Rifle' },
  // Pistols
  { name: 'GS45', class: 'Pistol' },
  { name: '9mm PM', class: 'Pistol' },
  { name: 'Grekhova', class: 'Pistol' },
  { name: 'Stryder .22', class: 'Pistol' },
  // Launchers
  { name: 'Launcher (Lock-On)', class: 'Launcher' },
  { name: 'Launcher (Free-Fire)', class: 'Launcher' },
  // Melee
  { name: 'Combat Knife', class: 'Melee' },
  { name: 'Baseball Bat', class: 'Melee' }
];

// Sequential mastery tiers. "Onyx" and "Nova" are placeholder names standing
// in for whatever MW4's actual top-tier camos turn out to be called.
// `color` drives both the tier-line progress bar and the checklist styling —
// update it here (not in CSS) when real tier names/colors are announced.
const CAMO_TIERS = [
  { key: 'gold', label: 'Gold', color: 'var(--gold)' },
  { key: 'platinum', label: 'Platinum', color: '#c9f1f0' },
  { key: 'onyx', label: 'Onyx', color: '#a8a9ab' },
  { key: 'nova', label: 'Nova', color: '#ffffff' }
];

const WEAPON_CLASSES = [...new Set(WEAPONS.map(w => w.class))];

// Display label (usually plural) shown on the homepage class tiles.
// Falls back to "<class>s" for any class not listed here, so adding a new
// weapon class in the future doesn't require touching this map.
const CLASS_LABELS = {
  'Assault Rifle': 'Assault Rifles',
  'SMG': 'SMGs',
  'Shotgun': 'Shotguns',
  'LMG': 'LMGs',
  'Marksman Rifle': 'Marksman Rifles',
  'Sniper Rifle': 'Sniper Rifles',
  'Pistol': 'Pistols',
  'Launcher': 'Launchers',
  'Melee': 'Melee'
};

function classLabel(cls){
  return CLASS_LABELS[cls] || (cls + 's');
}

// ============================================================
// TRACKER MODES
// ============================================================
// Multiplayer, Warzone, and DMZ are tracked as fully independent progress
// tracks — completing a weapon's Gold in Multiplayer says nothing about its
// Warzone or DMZ progress. They share the same weapon roster (WEAPONS
// above) and, for now, the same CAMO_TIERS — real per-mode tier names and
// colors aren't known yet, so all three point at the identical tier list
// until MW4 reveals otherwise.
//
// `accent` drives the mode switcher, the eyebrow badge background, and any
// other mode-specific UI coloring. Multiplayer intentionally reuses the
// site's existing gold rather than getting its own hex, since gold is
// MW4's actual brand color, not just a placeholder.
const MODES = [
  { key: 'mp', label: 'Multiplayer', accent: 'var(--gold)' },
  { key: 'wz', label: 'Warzone', accent: 'var(--gold)' }, // was #CF5302 — reverted to gold, revisit if needed
  { key: 'dmz', label: 'DMZ', accent: 'var(--gold)' } // was #4FB9AF — reverted to gold, revisit if needed
];

const MODE_KEY_STORAGE = 'mw4camo-mode';

function getCurrentMode(){
  try{
    const stored = localStorage.getItem(MODE_KEY_STORAGE);
    if(MODES.some(m => m.key === stored)) return stored;
  }catch(e){}
  return MODES[0].key; // Multiplayer is the default
}

function setCurrentMode(modeKey){
  try{ localStorage.setItem(MODE_KEY_STORAGE, modeKey); }catch(e){}
}

function getModeInfo(modeKey){
  return MODES.find(m => m.key === modeKey) || MODES[0];
}

// Builds a mode-namespaced storage key, e.g. modeStorageKey('mw4camo-progress')
// -> 'mw4camo-progress-wz' when Warzone is the active mode. Used for every
// piece of data that's tracked per-mode (progress, grind list, recent log).
function modeStorageKey(baseKey){
  return baseKey + '-' + getCurrentMode();
}

// Applies the current mode's accent as a CSS custom property so any element
// referencing var(--mode-accent) picks it up, and keeps every open tab's
// eyebrow badge in sync if the mode changes elsewhere.
function applyModeAccent(){
  const mode = getModeInfo(getCurrentMode());
  document.documentElement.style.setProperty('--mode-accent', mode.accent);
  document.querySelectorAll('.mode-badge').forEach(el => { el.textContent = mode.label; });
}

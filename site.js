// Runs on every page load so the eyebrow badge, mode accent, and any other
// mode-aware styling stay correct regardless of which page you land on.
applyModeAccent();

// ---- Shared progress helpers ----
function loadCamoProgress(){
  try{
    const raw = localStorage.getItem(modeStorageKey('mw4camo-progress'));
    return raw ? JSON.parse(raw) : {};
  }catch(e){
    return {};
  }
}

function saveCamoProgress(progress){
  try{ localStorage.setItem(modeStorageKey('mw4camo-progress'), JSON.stringify(progress)); }catch(e){}
}

// A weapon counts as "mastered" once every tier in CAMO_TIERS is checked.
// Tiers are data-driven (see data.js), so this keeps working unchanged if
// the tier list changes size when MW4's real camo system is announced.
function isWeaponMastered(name, progress){
  const p = progress[name] || {};
  return CAMO_TIERS.every(t => p[t.key]);
}

// The color of the highest tier THIS weapon has earned so far (gold as
// soon as Gold is checked, moving up through platinum/onyx/nova as it
// progresses). Returns null if nothing's been earned yet.
function highestOwnTierColor(name, progress){
  const p = progress[name] || {};
  let color = null;
  CAMO_TIERS.forEach(t => { if(p[t.key]) color = t.color; });
  return color;
}

// True once every weapon in `weaponsArr` has tier `tierKey` checked.
function tierCompleteForWeapons(weaponsArr, tierKey, progress){
  return weaponsArr.length > 0 && weaponsArr.every(w => (progress[w.name] || {})[tierKey]);
}

// True once every weapon in `cls` has tier `tierKey` checked. Mastery camo
// tiers beyond Gold are gated at the class level (e.g. no weapon can start
// Platinum until every weapon in its class has Gold) rather than per-weapon.
function classTierComplete(cls, tierKey, progress){
  return tierCompleteForWeapons(WEAPONS.filter(w => w.class === cls), tierKey, progress);
}

// Re-validates an entire class's progress after a tier gets unchecked.
// Unchecking Gold on one weapon means Platinum was never legitimately
// attainable for the whole class (every weapon needs Gold first) — so any
// weapon in the class already holding Platinum or higher has it stripped
// too. This cascades tier by tier: if that strip also breaks Platinum's
// class-wide completeness, Onyx gets stripped next, and so on up to Nova.
function enforceClassGating(cls, progress){
  const weapons = WEAPONS.filter(w => w.class === cls);
  for(let i = 1; i < CAMO_TIERS.length; i++){
    const prevKey = CAMO_TIERS[i - 1].key;
    if(!tierCompleteForWeapons(weapons, prevKey, progress)){
      for(let j = i; j < CAMO_TIERS.length; j++){
        const key = CAMO_TIERS[j].key;
        weapons.forEach(w => {
          if(progress[w.name]) progress[w.name][key] = false;
        });
      }
    }
  }
}

// The color of the highest tier that's fully complete across every weapon
// in `weaponsArr` (used to recolor a class tile once, say, all Gold is in).
// Returns null if not even the first tier is fully complete yet.
function highestCompleteTierColor(weaponsArr, progress){
  let color = null;
  for(let i = 0; i < CAMO_TIERS.length; i++){
    if(tierCompleteForWeapons(weaponsArr, CAMO_TIERS[i].key, progress)) color = CAMO_TIERS[i].color;
    else break;
  }
  return color;
}

// Whether a given tier is unlocked for a specific weapon right now.
function tierUnlocked(weapon, tierIndex, progress){
  if(tierIndex === 0) return true; // Gold has no prerequisite
  const prevTier = CAMO_TIERS[tierIndex - 1];
  return classTierComplete(weapon.class, prevTier.key, progress);
}

function nextTierLabel(name){
  const progress = loadCamoProgress();
  const p = progress[name] || {};
  const next = CAMO_TIERS.find(t => !p[t.key]);
  return next ? 'Next: ' + next.label : 'All tiers complete';
}

// Checks the next available tier for a weapon (used by the "Next Camo"
// button in the Grind List). Respects the same class-wide gate as the
// checklist on the Camo Tracker page — a weapon can't advance to Platinum
// until every weapon in its class has Gold, and so on up the tiers. No-ops
// if the next tier is locked or the weapon is already fully mastered.
function advanceNextTier(name){
  const weapon = weaponLookup(name);
  const progress = loadCamoProgress();
  const p = progress[name] || {};
  const nextIndex = CAMO_TIERS.findIndex(t => !p[t.key]);
  if(nextIndex === -1) return; // already fully mastered
  if(!tierUnlocked(weapon, nextIndex, progress)) return; // rest of the class hasn't caught up yet
  if(!progress[name]) progress[name] = {};
  progress[name][CAMO_TIERS[nextIndex].key] = true;
  saveCamoProgress(progress);
  logCamoChange(name, CAMO_TIERS[nextIndex].key);
  renderGrindList();
  document.dispatchEvent(new CustomEvent('grindlist:changed'));
}

// ---- Recent activity log ----
// A simple feed of every tier earned, most recent first, shown on
// recent.html. Capped so localStorage doesn't grow without bound.
const RECENT_LOG_KEY = 'mw4camo-recent';
const RECENT_LOG_LIMIT = 200;

// ---- Undo toast ----
// Shared by any "remove" action on the site. The actual destructive step
// (saving to storage, or in Mapfam's shared mode, calling the delete API)
// is deferred until the toast times out — so if the user hits Undo in time,
// nothing was ever actually thrown away, not even server-side.
let _undoToastEl = null;
let _undoToastTimer = null;

function showUndoToast(message, onCommit, onUndo){
  if(_undoToastEl){
    clearTimeout(_undoToastTimer);
    if(_undoToastEl._onCommit) _undoToastEl._onCommit(); // finalize whatever was already pending
    _undoToastEl.remove();
    _undoToastEl = null;
  }
  const toast = document.createElement('div');
  toast.className = 'undo-toast';
  toast.innerHTML = '<span class="undo-toast-msg"></span><button class="undo-toast-btn" type="button">Undo</button>';
  toast.querySelector('.undo-toast-msg').textContent = message;
  document.body.appendChild(toast);
  toast._onCommit = onCommit;
  _undoToastEl = toast;

  toast.querySelector('.undo-toast-btn').addEventListener('click', () => {
    clearTimeout(_undoToastTimer);
    onUndo();
    toast.remove();
    _undoToastEl = null;
  });

  requestAnimationFrame(() => toast.classList.add('open'));
  _undoToastTimer = setTimeout(() => {
    onCommit();
    toast.classList.remove('open');
    setTimeout(() => toast.remove(), 200);
    _undoToastEl = null;
  }, 6000);
}

function loadRecentLog(){
  try{
    const raw = localStorage.getItem(modeStorageKey(RECENT_LOG_KEY));
    return raw ? JSON.parse(raw) : [];
  }catch(e){
    return [];
  }
}

function saveRecentLog(list){
  try{ localStorage.setItem(modeStorageKey(RECENT_LOG_KEY), JSON.stringify(list)); }catch(e){}
}

function logCamoChange(weaponName, tierKey){
  const w = weaponLookup(weaponName);
  const tier = CAMO_TIERS.find(t => t.key === tierKey);
  if(!tier) return;
  const log = loadRecentLog();
  log.unshift({ name: w.name, class: w.class, tierKey: tier.key, tierLabel: tier.label, ts: Date.now() });
  saveRecentLog(log.slice(0, RECENT_LOG_LIMIT));
}

function formatRelativeTime(ts){
  const diffSec = Math.round((Date.now() - ts) / 1000);
  if(diffSec < 5) return 'Just now';
  if(diffSec < 60) return diffSec + 's ago';
  const diffMin = Math.round(diffSec / 60);
  if(diffMin < 60) return diffMin + 'm ago';
  const diffHr = Math.round(diffMin / 60);
  if(diffHr < 24) return diffHr + 'h ago';
  const diffDay = Math.round(diffHr / 24);
  if(diffDay < 7) return diffDay + 'd ago';
  return new Date(ts).toLocaleDateString();
}

// Renders the recent-activity feed on recent.html.
// Renders the recent-activity feed on recent.html. Rows are clickable
// (jump to that weapon's class on the Camo Tracker page); each has its own
// remove button, plus a page-level "Clear All" wired up separately.
// Renders a given log array (doesn't touch storage — used both for the
// normal load and for optimistically showing a pending removal before it's
// actually committed).
function renderRecentRows(containerId, log){
  const el = document.getElementById(containerId);
  if(!el) return;
  el.innerHTML = log.length
    ? log.map((entry, i) =>
        '<div class="recent-row" data-index="'+i+'" data-class="'+entry.class+'" role="button" tabindex="0">' +
          '<span class="recent-dot" style="background:'+(CAMO_TIERS.find(t => t.key === entry.tierKey) || {}).color+'"></span>' +
          '<span class="recent-main">' +
            '<span class="recent-weapon">'+entry.name+'</span>' +
            '<span class="recent-class">'+entry.class+'</span>' +
          '</span>' +
          '<span class="recent-tier">'+entry.tierLabel+'</span>' +
          '<span class="recent-time">'+formatRelativeTime(entry.ts)+'</span>' +
          '<button class="recent-remove" data-index="'+i+'" type="button" aria-label="Remove entry">&times;</button>' +
        '</div>'
      ).join('')
    : '<div class="empty-note">No camo activity yet. Check off a tier on the Camo Tracker page to see it here.</div>';

  el.querySelectorAll('.recent-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute('data-index'), 10);
      const currentLog = loadRecentLog();
      const removed = currentLog[idx];
      const remaining = currentLog.slice(0, idx).concat(currentLog.slice(idx + 1));
      renderRecentRows(containerId, remaining); // optimistic — nothing saved yet
      showUndoToast(
        'Removed "' + removed.name + ' \u00b7 ' + removed.tierLabel + '"',
        () => saveRecentLog(remaining),        // commit: only now actually saved
        () => renderRecentList(containerId)     // undo: re-render from untouched storage
      );
    });
  });
  el.querySelectorAll('.recent-row').forEach(row => {
    row.addEventListener('click', () => {
      window.location.href = 'camos.html?class=' + encodeURIComponent(row.getAttribute('data-class'));
    });
    row.addEventListener('keydown', (e) => {
      if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); row.click(); }
    });
  });
}

function renderRecentList(containerId){
  renderRecentRows(containerId, loadRecentLog());
}

// Wires up the "Clear All" button on recent.html.
function initRecentClearAll(buttonId, listContainerId){
  const btn = document.getElementById(buttonId);
  if(!btn) return;
  btn.addEventListener('click', () => {
    const currentLog = loadRecentLog();
    if(!currentLog.length) return;
    renderRecentRows(listContainerId, []); // optimistic — nothing saved yet
    showUndoToast(
      'Cleared ' + currentLog.length + ' entr' + (currentLog.length === 1 ? 'y' : 'ies'),
      () => saveRecentLog([]),
      () => renderRecentList(listContainerId)
    );
  });
}

// ---- Grind List (pinned weapons currently being worked on) ----
const GRIND_LIST_KEY = 'mw4camo-grindlist';

function loadGrindList(){
  try{
    const raw = localStorage.getItem(modeStorageKey(GRIND_LIST_KEY));
    return raw ? JSON.parse(raw) : [];
  }catch(e){
    return [];
  }
}

function saveGrindList(list){
  try{ localStorage.setItem(modeStorageKey(GRIND_LIST_KEY), JSON.stringify(list)); }catch(e){}
}

let grindList = loadGrindList();

const grindListEl = document.getElementById('grindList');
const grindListToggle = document.getElementById('grindListToggle');
const grindListFullscreen = document.getElementById('grindListFullscreen');
const grindListPanel = document.getElementById('grindListPanel');
const grindListCount = document.getElementById('grindListCount');

function weaponLookup(name){
  return WEAPONS.find(w => w.name === name) || { name: name, class: '' };
}

// ---- Full Screen mode (identical behavior to Easy Tarkov's "Infil") ----
// Takes over the whole viewport: the page's own content is hidden (via a
// body class) and the Grind List panel fills the space instead, scaling
// item text based on how much room each pinned weapon gets.
function applyFullscreenSizing(){
  if(!grindListEl.classList.contains('fullscreen')) return;
  const barHeight = grindListEl.querySelector('.grind-list-bar').getBoundingClientRect().height;
  const panelHeight = Math.max(200, window.innerHeight - barHeight);
  grindListPanel.style.height = panelHeight + 'px';

  const budget = panelHeight / Math.max(1, grindList.length);
  grindListEl.classList.remove('fs-lg', 'fs-md', 'fs-sm');
  grindListEl.classList.add(budget >= 90 ? 'fs-lg' : budget >= 60 ? 'fs-md' : 'fs-sm');
}

function renderGrindList(){
  if(!grindListEl) return;
  applyFullscreenSizing();
  const progress = loadCamoProgress();
  grindListCount.textContent = grindList.length;
  grindListPanel.innerHTML = grindList.length
    ? grindList.map(name => {
        const w = weaponLookup(name);
        const mastered = isWeaponMastered(name, progress);
        const p = progress[name] || {};
        const nextIndex = CAMO_TIERS.findIndex(t => !p[t.key]);
        const unlocked = nextIndex !== -1 && tierUnlocked(w, nextIndex, progress);
        const nextBtnHtml = mastered
          ? ''
          : '<button class="grind-item-next" data-name="'+name+'" type="button"'+(unlocked ? '' : ' disabled title="Locked until the rest of the class catches up"')+'>Next Camo</button>';
        return '<div class="grind-item" data-name="'+name+'">' +
          '<span><span class="grind-item-name">'+w.name+'</span><br>' +
          '<span class="grind-item-sub">'+w.class+' &middot; '+nextTierLabel(name)+'</span></span>' +
          '<span class="grind-item-actions">' +
            '<a class="grind-item-view" href="camos.html?class='+encodeURIComponent(w.class)+'">View Class</a>' +
            nextBtnHtml +
            '<button class="grind-item-remove" data-name="'+name+'" type="button">Remove</button>' +
          '</span>' +
        '</div>';
      }).join('')
    : '<div class="grind-list-empty">No weapons pinned. Click any weapon on the Camo Tracker page to pin it here.</div>';
}

if(grindListEl){
  grindListToggle.addEventListener('click', () => grindListEl.classList.toggle('open'));
  grindListToggle.addEventListener('keydown', (e) => {
    if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); grindListEl.classList.toggle('open'); }
  });
  grindListCount.addEventListener('click', (e) => {
    e.stopPropagation();
    if(!grindList.length) return;
    grindList = [];
    saveGrindList(grindList);
    renderGrindList();
    document.dispatchEvent(new CustomEvent('grindlist:changed'));
  });
  if(grindListFullscreen){
    grindListFullscreen.addEventListener('click', (e) => {
      e.stopPropagation();
      const active = grindListEl.classList.toggle('fullscreen');
      document.body.classList.toggle('grindlist-fullscreen', active);
      if(active){
        grindListEl.classList.add('open');
      }else{
        // Minimise returns to the square popup (still open), not fully closed.
        grindListEl.classList.remove('fs-lg', 'fs-md', 'fs-sm');
        grindListPanel.style.height = '';
      }
      grindListFullscreen.textContent = active ? 'Minimise' : 'Full Screen';
      renderGrindList();
    });
  }
  grindListPanel.addEventListener('click', (e) => {
    const removeBtn = e.target.closest('.grind-item-remove');
    if(removeBtn){
      const name = removeBtn.getAttribute('data-name');
      grindList = grindList.filter(n => n !== name);
      saveGrindList(grindList);
      renderGrindList();
      document.dispatchEvent(new CustomEvent('grindlist:changed'));
      return;
    }
    const nextBtn = e.target.closest('.grind-item-next');
    if(nextBtn){
      advanceNextTier(nextBtn.getAttribute('data-name'));
      return;
    }
  });
  renderGrindList();
  window.addEventListener('resize', applyFullscreenSizing);
}

// Pins/unpins a weapon into the Grind List. Fires an event so any checklist
// on the page can refresh its own "pinned" indicators without a hard reload.
function togglePin(name){
  if(grindList.includes(name)){
    grindList = grindList.filter(n => n !== name);
  }else{
    grindList.push(name);
  }
  saveGrindList(grindList);
  renderGrindList();
  document.dispatchEvent(new CustomEvent('grindlist:changed'));
}

// ---- Mobile nav menu ----
const topbarRightEl = document.querySelector('.topbar-right');
if(topbarRightEl){
  const mobileMenuWrap = document.createElement('div');
  mobileMenuWrap.className = 'mobile-menu-wrap';

  const mobileMenuBtn = document.createElement('button');
  mobileMenuBtn.type = 'button';
  mobileMenuBtn.className = 'mobile-menu-btn';
  mobileMenuBtn.setAttribute('aria-label', 'Open navigation menu');
  mobileMenuBtn.textContent = '\u2630 Menu';

  const mobileMenuPanel = document.createElement('div');
  mobileMenuPanel.className = 'mobile-menu-panel';

  const staticLinks = [
    { name: 'Home', url: 'index.html' },
    { name: 'Camo Tracker', url: 'camos.html' },
    { name: 'Stats', url: 'stats.html' },
    { name: 'Recent', url: 'recent.html' },
    { name: 'Mapfam', url: 'mapfam.html' },
    { name: 'Manage Data', url: 'import.html', danger: true }
  ];

  mobileMenuPanel.innerHTML = staticLinks.map(l => '<a href="'+l.url+'"'+(l.danger ? ' class="mobile-menu-danger"' : '')+'>'+l.name+'</a>').join('');

  mobileMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    mobileMenuPanel.classList.toggle('open');
  });

  mobileMenuWrap.appendChild(mobileMenuBtn);
  mobileMenuWrap.appendChild(mobileMenuPanel);
  topbarRightEl.appendChild(mobileMenuWrap);

  document.addEventListener('click', (e) => {
    if(!e.target.closest('.mobile-menu-wrap')) mobileMenuPanel.classList.remove('open');
  });
}

// ---- Keyboard shortcut: Esc closes open panels ----
document.addEventListener('keydown', (e) => {
  if(e.key === 'Escape' && grindListEl) grindListEl.classList.remove('open');
});

// ---- Homepage: weapon class summary tiles ----
// Renders one tile per class (e.g. "Assault Rifles 2/7") linking into the
// Camo Tracker pre-filtered to that class, plus an "All Weapons" tile.
// Homepage search: live dropdown of matching weapons, each linking into
// the Camo Tracker pre-filtered to that weapon's class with the search
// term carried over (?class=X&search=Y), so the same result is highlighted
// there instead of just dumping the visitor on an unfiltered page.
function initHomeWeaponSearch(inputId, resultsId){
  const input = document.getElementById(inputId);
  const results = document.getElementById(resultsId);
  if(!input || !results) return;

  function renderResults(query){
    const q = query.trim().toLowerCase();
    if(!q){ results.classList.remove('open'); results.innerHTML = ''; return; }
    const matches = WEAPONS.filter(w => w.name.toLowerCase().includes(q)).slice(0, 8);
    results.innerHTML = matches.length
      ? matches.map(w =>
          '<div class="home-search-row" data-name="'+w.name+'" data-class="'+w.class+'">' +
            '<span class="home-search-name">'+w.name+'</span>' +
            '<span class="home-search-class">'+w.class+'</span>' +
          '</div>'
        ).join('')
      : '<div class="home-search-empty">No weapons found</div>';
    results.classList.add('open');
  }

  input.addEventListener('input', () => renderResults(input.value));
  input.addEventListener('focus', () => renderResults(input.value));
  results.addEventListener('click', (e) => {
    const row = e.target.closest('.home-search-row');
    if(!row) return;
    const cls = row.getAttribute('data-class');
    const name = row.getAttribute('data-name');
    window.location.href = 'camos.html?class=' + encodeURIComponent(cls) + '&search=' + encodeURIComponent(name);
  });
  document.addEventListener('click', (e) => {
    if(!e.target.closest('.home-search-wrap')) results.classList.remove('open');
  });
  document.addEventListener('keydown', (e) => {
    if(e.key === 'Escape') results.classList.remove('open');
  });
}

// Full 3-pill switcher, used on the homepage. Switching mode reloads the
// page — simplest way to guarantee every piece of mode-aware state
// (progress, grind list, recent log, accent color, eyebrow badge) re-reads
// from the newly-selected mode's storage rather than needing each of those
// systems to support being swapped out live.
function renderModeSwitcher(containerId){
  const el = document.getElementById(containerId);
  if(!el) return;
  const current = getCurrentMode();
  el.innerHTML = MODES.map(m =>
    '<button class="mode-pill'+(m.key === current ? ' active' : '')+'" data-mode="'+m.key+'" type="button" style="--pill-accent:'+m.accent+'">'+m.label+'</button>'
  ).join('');
  el.querySelectorAll('.mode-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-mode');
      if(mode === getCurrentMode()) return;
      setCurrentMode(mode);
      window.location.reload();
    });
  });
}

// Compact dropdown version for the nav bar on every other page, so you can
// switch modes without needing to go back to the homepage first.
function renderNavModeSwitcher(wrapId){
  const wrap = document.getElementById(wrapId);
  if(!wrap) return;
  const current = getCurrentMode();
  const currentInfo = getModeInfo(current);
  wrap.innerHTML =
    '<button class="nav-mode-btn" id="navModeBtn" type="button">'+currentInfo.label+' <span class="nav-mode-caret">&#9662;</span></button>' +
    '<div class="nav-mode-menu" id="navModeMenu">' +
      MODES.map(m =>
        '<button class="nav-mode-option'+(m.key === current ? ' active' : '')+'" data-mode="'+m.key+'" type="button" style="--pill-accent:'+m.accent+'">'+m.label+'</button>'
      ).join('') +
    '</div>';

  const btn = document.getElementById('navModeBtn');
  const menu = document.getElementById('navModeMenu');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.toggle('open');
  });
  menu.querySelectorAll('.nav-mode-option').forEach(opt => {
    opt.addEventListener('click', () => {
      const mode = opt.getAttribute('data-mode');
      if(mode !== getCurrentMode()){
        setCurrentMode(mode);
        window.location.reload();
      }
    });
  });
  document.addEventListener('click', (e) => {
    if(!e.target.closest('.nav-mode-switcher')) menu.classList.remove('open');
  });
}

function renderClassSummary(containerId){
  const el = document.getElementById(containerId);
  if(!el) return;
  const progress = loadCamoProgress();

  function tile(label, count, total, href, weaponsInScope){
    const maxed = total > 0 && count === total;
    const color = highestCompleteTierColor(weaponsInScope, progress);
    const styleAttr = (!maxed && color) ? ' style="--tile-border:' + color + '"' : '';
    return '<a class="class-tile'+(maxed ? ' maxed' : '')+'" href="'+href+'"'+styleAttr+'>' +
      '<span class="card-inner">' +
        '<span class="class-tile-name">'+label+'</span>' +
        '<span class="class-tile-count">'+count+'/'+total+'</span>' +
      '</span>' +
    '</a>';
  }

  const allDone = WEAPONS.filter(w => isWeaponMastered(w.name, progress)).length;
  let html = tile('All Weapons', allDone, WEAPONS.length, 'camos.html', WEAPONS);

  WEAPON_CLASSES.forEach(cls => {
    const weapons = WEAPONS.filter(w => w.class === cls);
    const done = weapons.filter(w => isWeaponMastered(w.name, progress)).length;
    html += tile(classLabel(cls), done, weapons.length, 'camos.html?class=' + encodeURIComponent(cls), weapons);
  });

  el.innerHTML = html;
}

// ---- Camo checklist renderer (per-weapon, sequential/class-gated tiers) ----
// config = { listElId, classFilterId, filterEmptyId }
function initCamoChecklist(config){
  const listEl = document.getElementById(config.listElId);
  let progress = loadCamoProgress();

  const params = new URLSearchParams(window.location.search);
  const requestedClass = params.get('class');
  let activeClass = (requestedClass && WEAPON_CLASSES.includes(requestedClass)) ? requestedClass : 'All';

  function scopedWeapons(){
    return activeClass === 'All' ? WEAPONS : WEAPONS.filter(w => w.class === activeClass);
  }

  // Search filters which cards are shown, but deliberately doesn't affect
  // scopedWeapons() — the progress bar/percentage stay about the whole
  // class, not just whatever the search happens to currently match.
  let searchQuery = params.get('search') || '';
  function visibleWeapons(){
    const scope = scopedWeapons();
    if(!searchQuery) return scope;
    const q = searchQuery.toLowerCase();
    return scope.filter(w => w.name.toLowerCase().includes(q));
  }

  // Big % reflects Gold completion for the current scope (the headline the
  // design calls out), with a labeled bar-row underneath for every tier so
  // the breakdown stays legible on narrow screens too.
  function updateProgressBar(){
    const scope = scopedWeapons();
    const total = scope.length;
    const bigPct = document.getElementById('progressBigPct');
    const bars = document.getElementById('progressBars');

    const tierStats = CAMO_TIERS.map(t => {
      const done = scope.filter(w => (progress[w.name] || {})[t.key]).length;
      return { tier: t, done: done, pct: total ? Math.round((done / total) * 100) : 0 };
    });

    const label = activeClass === 'All' ? 'All Weapons' : classLabel(activeClass);

    // Overall completion: 100% only once every weapon in scope has every
    // tier (Nova) — not just Gold, which was the old (incorrect) behavior.
    const totalPossible = total * CAMO_TIERS.length;
    const totalEarned = tierStats.reduce((sum, s) => sum + s.done, 0);
    const overallPct = totalPossible ? Math.round((totalEarned / totalPossible) * 100) : 0;

    // The headline number's color tracks the highest tier anyone in this
    // scope has started earning — gold by default, then platinum, onyx,
    // and finally nova as soon as any weapon reaches each stage.
    let activeColor = CAMO_TIERS[0].color;
    for(let i = CAMO_TIERS.length - 1; i >= 0; i--){
      if(tierStats[i].done > 0){ activeColor = CAMO_TIERS[i].color; break; }
    }

    if(bigPct){
      bigPct.innerHTML = overallPct + '%<span>' + label + ' &middot; Overall</span>';
      bigPct.style.color = activeColor;
    }
    if(bars){
      bars.innerHTML = tierStats.map(s =>
        '<div class="bar-row">' +
          '<div class="bar-label">' + s.tier.label + '</div>' +
          '<div class="bar-track"><div class="bar-fill" style="width:' + s.pct + '%;background:' + s.tier.color + ';"></div></div>' +
          '<div class="bar-count">' + s.done + '/' + total + '</div>' +
        '</div>'
      ).join('');
    }

    // Progress block's own outline: gold once the whole scope has Gold,
    // then platinum, onyx, nova as each tier gets fully completed.
    const progressBlock = document.getElementById('progressBlock');
    if(progressBlock){
      const outlineColor = highestCompleteTierColor(scope, progress);
      if(outlineColor) progressBlock.style.setProperty('--tier-border', outlineColor);
      else progressBlock.style.removeProperty('--tier-border');
    }
  }

  function renderRow(w){
    const p = progress[w.name] || {};
    const pinned = grindList.includes(w.name);
    const swatchesHtml = CAMO_TIERS.map((t, i) => {
      const unlocked = tierUnlocked(w, i, progress);
      const done = !!p[t.key];
      const locked = !unlocked && !done;
      const chipStyle = done ? 'background:' + t.color + ';border-color:transparent;' : (locked ? '' : 'border-color:' + t.color + ';');
      return '<label class="tier-swatch'+(done ? ' tier-done' : '')+(locked ? ' tier-locked' : '')+'">' +
        '<input class="sr-only" type="checkbox" data-name="'+w.name+'" data-tier="'+t.key+'"'+(done ? ' checked' : '')+(locked ? ' disabled' : '')+'>' +
        '<span class="swatch-chip'+(locked ? ' locked' : '')+'" style="'+chipStyle+'"></span>' +
        '<span class="swatch-label">'+t.label+'</span>' +
      '</label>';
    }).join('');
    const cardColor = highestOwnTierColor(w.name, progress);
    const cardStyle = cardColor ? ' style="--card-border:' + cardColor + '"' : '';
    return '<div class="weapon-card'+(pinned ? ' pinned' : '')+'" data-name="'+w.name+'" data-class="'+w.class+'"'+cardStyle+'>' +
      '<div class="card-inner">' +
        '<div class="weapon-name">'+w.name+'</div>' +
        '<div class="weapon-class">'+w.class+'</div>' +
        '<div class="swatch-row">'+swatchesHtml+'</div>' +
      '</div>' +
    '</div>';
  }

  function render(){
    const visible = visibleWeapons();
    const hasClassMatches = scopedWeapons().length > 0;
    listEl.innerHTML = visible.length
      ? visible.map(renderRow).join('')
      : '<div class="empty-note">' + (hasClassMatches ? 'No weapons match your search.' : 'No weapons in this class yet.') + '</div>';
    bindRowEvents();
    updateProgressBar();
    updateFilterEmpty();
    renderClassFilterButtons();
  }

  function bindRowEvents(){
    // Tier swatches: change progress, don't trigger the card's pin click.
    listEl.querySelectorAll('.tier-swatch input').forEach(box => {
      box.addEventListener('change', () => {
        const name = box.getAttribute('data-name');
        const tier = box.getAttribute('data-tier');
        if(!progress[name]) progress[name] = {};
        progress[name][tier] = box.checked;
        // Unchecking a tier also clears any tiers that come after it for
        // THIS weapon, since tiers are sequential per weapon.
        if(!box.checked){
          const idx = CAMO_TIERS.findIndex(t => t.key === tier);
          CAMO_TIERS.slice(idx + 1).forEach(t => { progress[name][t.key] = false; });
          // It can also invalidate tiers already earned on OTHER weapons in
          // the same class, since higher tiers require every weapon to have
          // cleared the one below first.
          enforceClassGating(weaponLookup(name).class, progress);
        }
        saveCamoProgress(progress);
        if(box.checked) logCamoChange(name, tier);
        renderGrindList(); // keep "Next: X" labels in the Grind List current
        render();
      });
    });
    listEl.querySelectorAll('.tier-swatch').forEach(label => {
      label.addEventListener('click', (e) => e.stopPropagation());
    });

    // Clicking anywhere else on a weapon's card pins/unpins it.
    listEl.querySelectorAll('.weapon-card').forEach(card => {
      card.addEventListener('click', () => {
        togglePin(card.getAttribute('data-name'));
        render();
      });
    });
  }

  function updateFilterEmpty(){
    const filterEmpty = config.filterEmptyId ? document.getElementById(config.filterEmptyId) : null;
    if(filterEmpty) filterEmpty.style.display = scopedWeapons().length === 0 ? 'block' : 'none';
  }

  const classFilterEl = config.classFilterId ? document.getElementById(config.classFilterId) : null;

  // Builds/refreshes the class filter pills. Each button's border reflects
  // the highest tier that class has FULLY completed (every weapon in it) —
  // at 100% that's Nova, whose color is white, so the outline naturally
  // goes white with no special-casing needed.
  function renderClassFilterButtons(){
    if(!classFilterEl) return;
    classFilterEl.innerHTML = ['All', ...WEAPON_CLASSES].map(c => {
      const weaponsInScope = c === 'All' ? WEAPONS : WEAPONS.filter(w => w.class === c);
      const color = highestCompleteTierColor(weaponsInScope, progress);
      const styleAttr = color ? ' style="--tier-border:' + color + '"' : '';
      const classes = 'class-filter-btn' + (c === activeClass ? ' active' : '');
      return '<button class="'+classes+'" data-class="'+c+'" type="button"'+styleAttr+'>'+(c === 'All' ? 'All' : classLabel(c))+'</button>';
    }).join('');
  }

  if(classFilterEl){
    renderClassFilterButtons();
    classFilterEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.class-filter-btn');
      if(!btn) return;
      activeClass = btn.getAttribute('data-class');
      render();
    });
  }

  const searchInputEl = config.searchInputId ? document.getElementById(config.searchInputId) : null;
  if(searchInputEl){
    if(searchQuery) searchInputEl.value = searchQuery;
    searchInputEl.addEventListener('input', () => {
      searchQuery = searchInputEl.value.trim();
      render();
    });
  }

  // If progress changes elsewhere (e.g. a Next Camo click, or the Grind
  // List gets cleared), reflect it here without requiring a page reload.
  document.addEventListener('grindlist:changed', () => {
    progress = loadCamoProgress();
    render();
  });

  render();
}

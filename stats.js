// ============================================================
// STATS ENGINE
// ============================================================
// Two data sources, used for what each is actually good at:
//   - loadCamoProgress() is the SOURCE OF TRUTH for current state (overall
//     %, tier counts, mastered weapons) — always accurate regardless of
//     how progress was set.
//   - loadRecentLog() is the ONLY source with timestamps, so it drives
//     everything date/time-based (streaks, the chart, mastery duration).
//     It's capped at 200 entries, comfortably above the 132 tiers a mode
//     can ever hold (33 weapons x 4 tiers), so it holds complete history
//     unless it's been manually cleared. One gap worth knowing: the
//     Manage Data "100% test" button and individual Recent removals don't
//     go through the normal log path, so time-based stats reflect
//     RECORDED activity, not necessarily literally everything that's ever
//     happened to your progress.

function computeStats(){
  const progress = loadCamoProgress();
  const log = loadRecentLog();
  const sortedLog = log.slice().sort((a, b) => a.ts - b.ts);

  // ---- Current-state stats (authoritative: from progress) ----
  const totalPossible = WEAPONS.length * CAMO_TIERS.length;
  const tierCounts = CAMO_TIERS.map(() => 0);
  let earned = 0;
  WEAPONS.forEach(w => {
    const p = progress[w.name] || {};
    CAMO_TIERS.forEach((t, i) => { if(p[t.key]){ earned++; tierCounts[i]++; } });
  });
  const overallPct = totalPossible ? Math.round((earned / totalPossible) * 100) : 0;
  const masteredWeapons = WEAPONS.filter(w => isWeaponMastered(w.name, progress));

  let activeColor = CAMO_TIERS[0].color;
  for(let i = CAMO_TIERS.length - 1; i >= 0; i--){
    if(tierCounts[i] > 0){ activeColor = CAMO_TIERS[i].color; break; }
  }

  // ---- Class breakdown ----
  const classStats = WEAPON_CLASSES.map(cls => {
    const weapons = WEAPONS.filter(w => w.class === cls);
    const classEarned = weapons.reduce((sum, w) => {
      const p = progress[w.name] || {};
      return sum + CAMO_TIERS.filter(t => p[t.key]).length;
    }, 0);
    const classPossible = weapons.length * CAMO_TIERS.length;
    return {
      cls: cls,
      label: classLabel(cls),
      pct: classPossible ? Math.round((classEarned / classPossible) * 100) : 0,
      masteredCount: weapons.filter(w => isWeaponMastered(w.name, progress)).length,
      total: weapons.length,
      color: highestCompleteTierColor(weapons, progress)
    };
  }).sort((a, b) => b.pct - a.pct);

  // ---- Day-level grouping (for streaks, busiest day, the chart) ----
  function dayKey(ts){
    const d = new Date(ts);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  const dayMap = {};
  sortedLog.forEach(e => { dayMap[dayKey(e.ts)] = (dayMap[dayKey(e.ts)] || 0) + 1; });
  const sortedDays = Object.keys(dayMap).sort();
  const daysActive = sortedDays.length;

  let busiestDay = null, busiestCount = 0;
  sortedDays.forEach(d => { if(dayMap[d] > busiestCount){ busiestCount = dayMap[d]; busiestDay = d; } });

  let longestStreak = 0, run = 0, prevDate = null;
  sortedDays.forEach(d => {
    const dateObj = new Date(d + 'T00:00:00');
    run = (prevDate && Math.round((dateObj - prevDate) / 86400000) === 1) ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
    prevDate = dateObj;
  });

  let currentStreak = 0;
  if(sortedDays.length){
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const lastActive = new Date(sortedDays[sortedDays.length - 1] + 'T00:00:00');
    if(Math.round((today - lastActive) / 86400000) <= 1){
      currentStreak = 1;
      for(let i = sortedDays.length - 2; i >= 0; i--){
        const d1 = new Date(sortedDays[i + 1] + 'T00:00:00');
        const d0 = new Date(sortedDays[i] + 'T00:00:00');
        if(Math.round((d1 - d0) / 86400000) === 1) currentStreak++;
        else break;
      }
    }
  }

  // ---- Cumulative series for the chart ----
  let cum = 0;
  const cumulativeSeries = sortedDays.map(d => { cum += dayMap[d]; return { date: d, cumulative: cum }; });

  // ---- Milestones ----
  const firstEntry = sortedLog[0] || null;
  const lastEntry = sortedLog[sortedLog.length - 1] || null;

  const masteryTimes = [];
  masteredWeapons.forEach(w => {
    const entries = sortedLog.filter(e => e.name === w.name);
    const goldEntry = entries.find(e => e.tierKey === 'gold');
    const novaEntry = entries.slice().reverse().find(e => e.tierKey === 'nova');
    if(goldEntry && novaEntry && novaEntry.ts >= goldEntry.ts){
      masteryTimes.push({
        name: w.name,
        days: Math.round((novaEntry.ts - goldEntry.ts) / 86400000),
        masteredAt: novaEntry.ts
      });
    }
  });
  masteryTimes.sort((a, b) => a.masteredAt - b.masteredAt);

  return {
    overallPct, earned, totalPossible, activeColor,
    masteredWeapons, tierCounts, classStats,
    daysActive, busiestDay, busiestCount, longestStreak, currentStreak,
    avgPerActiveDay: daysActive ? (sortedLog.length / daysActive) : 0,
    cumulativeSeries, firstEntry, lastEntry, masteryTimes,
    totalLogged: sortedLog.length
  };
}

function formatStatDate(tsOrDayKey){
  const d = typeof tsOrDayKey === 'number' ? new Date(tsOrDayKey) : new Date(tsOrDayKey + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Hand-built SVG line/area chart — no charting library, consistent with
// how the rest of this site avoids external dependencies. Returns null
// when there isn't enough data to plot anything meaningful.
function buildCumulativeChartSVG(series, accentColor){
  if(!series || series.length < 2) return null;

  const W = 900, H = 260;
  const pad = { top: 20, right: 24, bottom: 34, left: 44 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const maxY = series[series.length - 1].cumulative;
  const n = series.length;

  const points = series.map((pt, i) => {
    const x = pad.left + (n === 1 ? 0 : (i / (n - 1)) * plotW);
    const y = pad.top + plotH - (maxY ? (pt.cumulative / maxY) * plotH : 0);
    return [x, y];
  });

  const linePath = points.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const areaPath = linePath +
    ' L' + points[points.length - 1][0].toFixed(1) + ',' + (pad.top + plotH) +
    ' L' + points[0][0].toFixed(1) + ',' + (pad.top + plotH) + ' Z';

  // A handful of gridlines + Y-axis labels at 0/25/50/75/100%.
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map(frac => {
    const y = pad.top + plotH - frac * plotH;
    const label = Math.round(frac * maxY);
    return '<line x1="' + pad.left + '" y1="' + y.toFixed(1) + '" x2="' + (W - pad.right) + '" y2="' + y.toFixed(1) + '" stroke="#332f2a" stroke-width="1"/>' +
      '<text x="' + (pad.left - 8) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" font-size="11" fill="#948e84" font-family="Barlow, sans-serif">' + label + '</text>';
  }).join('');

  // X-axis labels: first, middle, last date only, to avoid clutter.
  const labelIdxs = n === 1 ? [0] : [0, Math.floor((n - 1) / 2), n - 1];
  const xLabels = labelIdxs.map(i => {
    const p = points[i];
    return '<text x="' + p[0].toFixed(1) + '" y="' + (H - 10) + '" text-anchor="middle" font-size="11" fill="#948e84" font-family="Barlow, sans-serif">' + formatStatDate(series[i].date) + '</text>';
  }).join('');

  return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="stats-chart-svg" preserveAspectRatio="xMidYMid meet">' +
    gridLines +
    '<path d="' + areaPath + '" fill="' + accentColor + '" opacity="0.15"/>' +
    '<path d="' + linePath + '" fill="none" stroke="' + accentColor + '" stroke-width="2.5"/>' +
    points.map(p => '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="2.5" fill="' + accentColor + '"/>').join('') +
    xLabels +
    '</svg>';
}

function renderStatsPage(containerId){
  const el = document.getElementById(containerId);
  if(!el) return;
  const s = computeStats();
  const modeLabel = getModeInfo(getCurrentMode()).label;

  const overviewHtml =
    '<div class="stats-overview">' +
      '<div class="stats-hero-pct" style="color:' + s.activeColor + '">' + s.overallPct + '%<span>Overall Progress \u00b7 ' + modeLabel + '</span></div>' +
      '<div class="stats-mini-grid">' +
        '<div class="stats-mini"><div class="stats-mini-value">' + s.earned + ' / ' + s.totalPossible + '</div><div class="stats-mini-label">Camos Earned</div></div>' +
        '<div class="stats-mini"><div class="stats-mini-value">' + s.masteredWeapons.length + ' / ' + WEAPONS.length + '</div><div class="stats-mini-label">Weapons Mastered</div></div>' +
        '<div class="stats-mini"><div class="stats-mini-value">' + s.daysActive + '</div><div class="stats-mini-label">Days Active</div></div>' +
        '<div class="stats-mini"><div class="stats-mini-value">' + s.currentStreak + '</div><div class="stats-mini-label">Current Streak</div></div>' +
      '</div>' +
    '</div>';

  const chartSvg = buildCumulativeChartSVG(s.cumulativeSeries, s.activeColor);
  const chartHtml = '<section class="stats-section">' +
    '<h2>Progress Over Time</h2>' +
    (chartSvg
      ? '<div class="stats-chart">' + chartSvg + '</div>' +
        '<div class="stats-chart-footnote">First camo: ' + (s.firstEntry ? formatStatDate(s.firstEntry.ts) : '\u2014') +
        ' &middot; Most recent: ' + (s.lastEntry ? formatStatDate(s.lastEntry.ts) : '\u2014') + '</div>'
      : '<div class="empty-note">Not enough recorded activity yet to chart \u2014 earn a few camos and check back.</div>') +
    '</section>';

  const habitsHtml = '<section class="stats-section">' +
    '<h2>Grinding Habits</h2>' +
    '<div class="stats-mini-grid">' +
      '<div class="stats-mini"><div class="stats-mini-value">' + s.longestStreak + '</div><div class="stats-mini-label">Longest Streak (days)</div></div>' +
      '<div class="stats-mini"><div class="stats-mini-value">' + (s.busiestDay ? s.busiestCount : '\u2014') + '</div><div class="stats-mini-label">' + (s.busiestDay ? 'Busiest Day (' + formatStatDate(s.busiestDay) + ')' : 'Busiest Day') + '</div></div>' +
      '<div class="stats-mini"><div class="stats-mini-value">' + s.avgPerActiveDay.toFixed(1) + '</div><div class="stats-mini-label">Avg Camos / Active Day</div></div>' +
      '<div class="stats-mini"><div class="stats-mini-value">' + s.totalLogged + '</div><div class="stats-mini-label">Total Logged Events</div></div>' +
    '</div>' +
  '</section>';

  const tierHtml = '<section class="stats-section">' +
    '<h2>By Tier</h2>' +
    '<div class="stats-tier-grid">' +
      CAMO_TIERS.map((t, i) => {
        const pct = WEAPONS.length ? Math.round((s.tierCounts[i] / WEAPONS.length) * 100) : 0;
        const color = t.color === 'var(--gold)' ? 'var(--gold)' : t.color;
        return '<div class="stats-tier-card"><div class="stats-tier-bar-track"><div class="stats-tier-bar-fill" style="width:' + pct + '%;background:' + color + ';"></div></div>' +
          '<div class="stats-tier-row"><span>' + t.label + '</span><span>' + s.tierCounts[i] + '/' + WEAPONS.length + '</span></div></div>';
      }).join('') +
    '</div>' +
  '</section>';

  const classHtml = '<section class="stats-section">' +
    '<h2>By Class</h2>' +
    '<div class="stats-class-list">' +
      s.classStats.map(c =>
        '<div class="stats-class-row" style="--tier-border:' + (c.color || 'var(--line)') + '">' +
          '<span class="stats-class-name">' + c.label + '</span>' +
          '<div class="stats-class-bar-track"><div class="stats-class-bar-fill" style="width:' + c.pct + '%;"></div></div>' +
          '<span class="stats-class-pct">' + c.pct + '%</span>' +
          '<span class="stats-class-count">' + c.masteredCount + '/' + c.total + ' mastered</span>' +
        '</div>'
      ).join('') +
    '</div>' +
  '</section>';

  const milestonesHtml = '<section class="stats-section">' +
    '<h2>Milestones</h2>' +
    (s.masteryTimes.length
      ? '<div class="stats-milestone-grid">' +
          '<div class="stats-milestone"><div class="stats-milestone-label">First Weapon Mastered</div><div class="stats-milestone-value">' + s.masteryTimes[0].name + '</div><div class="stats-milestone-sub">' + formatStatDate(s.masteryTimes[0].masteredAt) + '</div></div>' +
          '<div class="stats-milestone"><div class="stats-milestone-label">Most Recent Mastery</div><div class="stats-milestone-value">' + s.masteryTimes[s.masteryTimes.length - 1].name + '</div><div class="stats-milestone-sub">' + formatStatDate(s.masteryTimes[s.masteryTimes.length - 1].masteredAt) + '</div></div>' +
          '<div class="stats-milestone"><div class="stats-milestone-label">Fastest Mastery</div><div class="stats-milestone-value">' + s.masteryTimes.slice().sort((a, b) => a.days - b.days)[0].name + '</div><div class="stats-milestone-sub">' + s.masteryTimes.slice().sort((a, b) => a.days - b.days)[0].days + ' day(s) Gold\u2192Nova</div></div>' +
          '<div class="stats-milestone"><div class="stats-milestone-label">Slowest Mastery</div><div class="stats-milestone-value">' + s.masteryTimes.slice().sort((a, b) => b.days - a.days)[0].name + '</div><div class="stats-milestone-sub">' + s.masteryTimes.slice().sort((a, b) => b.days - a.days)[0].days + ' day(s) Gold\u2192Nova</div></div>' +
        '</div>'
      : '<div class="empty-note">No fully-mastered weapons with recorded Gold-to-Nova timestamps yet.</div>') +
  '</section>';

  el.innerHTML = overviewHtml + chartHtml + habitsHtml + tierHtml + classHtml + milestonesHtml;
}

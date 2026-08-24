// ============================================================
// PROGRESS CARD
// ============================================================
// Renders a shareable snapshot of current camo progress as a PNG, drawn
// entirely with the Canvas 2D API rather than an HTML-to-image library.
// That's a deliberate choice: libraries that rasterize DOM+CSS (html2canvas
// and similar) are notoriously inconsistent across browsers with custom
// @font-face fonts and cross-origin resources (like the Google-hosted
// Barlow font this site uses), sometimes silently tainting the canvas or
// falling back to a default font. Hand-drawing sidesteps all of that at
// the cost of manually positioning everything below.

const PC_COLORS = {
  bg: '#131211',
  panel: '#1c1a18',
  line: '#332f2a',
  paper: '#f2efe9',
  dim: '#948e84',
  danger: '#e0362b'
};

function pcTierHex(tier){
  // CAMO_TIERS' gold entry stores 'var(--gold)' (for use in real CSS), which
  // isn't valid inside a Canvas fillStyle - resolve it to the real hex here.
  return tier.color === 'var(--gold)' ? '#fecf41' : tier.color;
}

function pcLoadFonts(){
  return Promise.all([
    document.fonts.load('700 40px "Stack Sans Headline"'),
    document.fonts.load('700 16px "Barlow"'),
    document.fonts.load('400 16px "Barlow"')
  ]).then(() => document.fonts.ready);
}

function pcLoadImage(src){
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function pcDrawDiagonalPattern(ctx, w, h){
  ctx.save();
  ctx.strokeStyle = '#fecf41';
  ctx.globalAlpha = 0.05;
  ctx.lineWidth = 2;
  const step = 26;
  const diag = Math.sqrt(w * w + h * h);
  ctx.translate(w / 2, h / 2);
  ctx.rotate(45 * Math.PI / 180); // matches the site's 135deg CSS gradient angle
  for(let x = -diag; x < diag; x += step){
    ctx.beginPath();
    ctx.moveTo(x, -diag);
    ctx.lineTo(x, diag);
    ctx.stroke();
  }
  ctx.restore();
}

async function generateProgressCardCanvas(){
  await pcLoadFonts();
  const glyphImg = await pcLoadImage('mw4-vector.svg');

  const progress = loadCamoProgress();
  const totalPossible = WEAPONS.length * CAMO_TIERS.length;
  let earned = 0;
  const tierDone = CAMO_TIERS.map(() => 0);
  WEAPONS.forEach(w => {
    const p = progress[w.name] || {};
    CAMO_TIERS.forEach((t, i) => { if(p[t.key]){ earned++; tierDone[i]++; } });
  });
  const pct = totalPossible ? Math.round((earned / totalPossible) * 100) : 0;

  let activeColor = pcTierHex(CAMO_TIERS[0]);
  for(let i = CAMO_TIERS.length - 1; i >= 0; i--){
    if(tierDone[i] > 0){ activeColor = pcTierHex(CAMO_TIERS[i]); break; }
  }

  const CARD_W = 1080;
  const PAD = 64;
  const CLASS_COLS = 3;
  const classRows = Math.ceil(WEAPON_CLASSES.length / CLASS_COLS);
  const CLASS_H = 90;
  const CLASS_GAP = 14;

  // Compute total height from the content, same approach as the site's own
  // "let the layout decide" pages rather than a guessed fixed number.
  const headerH = 40;
  const heroH = 220 + 30 + 30; // number + gap + label
  const tierH = 140;
  const classesLabelH = 30;
  const classesH = classRows * CLASS_H + (classRows - 1) * CLASS_GAP;
  const footerH = 50;
  const gaps = 60 + 70 + 60 + 60; // between-section spacing used below
  const CARD_H = PAD * 2 + headerH + heroH + tierH + classesLabelH + classesH + footerH + gaps;

  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = PC_COLORS.bg;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  pcDrawDiagonalPattern(ctx, CARD_W, CARD_H);

  let y = PAD;

  // ---- Header: wordmark + placeholder badge ----
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = PC_COLORS.paper;
  ctx.font = '700 30px "Stack Sans Headline"';
  const titleBaseline = y + 32;
  ctx.fillText('MW', PAD, titleBaseline);
  const mwWidth = ctx.measureText('MW').width;
  const glyphH = 42;
  const glyphW = glyphH * (glyphImg.width / glyphImg.height);
  ctx.drawImage(glyphImg, PAD + mwWidth - 14, titleBaseline - 34, glyphW, glyphH);
  ctx.fillText('Camo Tracker', PAD + mwWidth - 14 + glyphW - 2, titleBaseline);

  const badgeText = 'PLACEHOLDER DATA';
  ctx.font = '700 13px Barlow';
  const badgeTextW = ctx.measureText(badgeText).width;
  const badgePadX = 16, badgeH = 38;
  const badgeW = badgeTextW + badgePadX * 2;
  const badgeX = CARD_W - PAD - badgeW;
  const badgeY = y;
  ctx.fillStyle = '#fecf41';
  ctx.beginPath();
  ctx.moveTo(badgeX, badgeY);
  ctx.lineTo(badgeX + badgeW, badgeY);
  ctx.lineTo(badgeX + badgeW - badgeW * 0.06, badgeY + badgeH);
  ctx.lineTo(badgeX, badgeY + badgeH);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = PC_COLORS.bg;
  ctx.font = '700 13px Barlow';
  ctx.fillText(badgeText, badgeX + badgePadX, badgeY + badgeH / 2 + 5);

  y = badgeY + badgeH + 60;

  // ---- Hero percentage ----
  ctx.textAlign = 'center';
  ctx.fillStyle = activeColor;
  ctx.font = '700 220px "Stack Sans Headline"';
  const heroBaseline = y + 172;
  ctx.fillText(pct + '%', CARD_W / 2, heroBaseline);
  y = heroBaseline + 40;
  ctx.font = '700 20px Barlow';
  ctx.fillStyle = PC_COLORS.dim;
  ctx.fillText('OVERALL PROGRESS \u00b7 ' + earned + ' OF ' + totalPossible + ' CAMOS EARNED', CARD_W / 2, y);

  y += 70;

  // ---- Tier row ----
  const tierGap = 16;
  const tierW = (CARD_W - PAD * 2 - tierGap * (CAMO_TIERS.length - 1)) / CAMO_TIERS.length;
  CAMO_TIERS.forEach((t, i) => {
    const x = PAD + i * (tierW + tierGap);
    const color = pcTierHex(t);
    ctx.fillStyle = PC_COLORS.panel;
    ctx.fillRect(x, y, tierW, tierH);
    ctx.strokeStyle = PC_COLORS.line;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, tierW - 1, tierH - 1);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, tierW, 4);

    ctx.textAlign = 'left';
    ctx.fillStyle = PC_COLORS.paper;
    ctx.font = '700 36px "Stack Sans Headline"';
    ctx.fillText(tierDone[i] + '/' + WEAPONS.length, x + 20, y + 70);
    ctx.fillStyle = PC_COLORS.dim;
    ctx.font = '700 13px Barlow';
    ctx.fillText(t.label.toUpperCase(), x + 20, y + 96);
  });

  y += tierH + 60;

  // ---- Class breakdown ----
  ctx.textAlign = 'left';
  ctx.fillStyle = PC_COLORS.dim;
  ctx.font = '700 15px Barlow';
  ctx.fillText('BY WEAPON CLASS', PAD, y);
  y += 30;

  const classW = (CARD_W - PAD * 2 - CLASS_GAP * (CLASS_COLS - 1)) / CLASS_COLS;
  WEAPON_CLASSES.forEach((cls, idx) => {
    const col = idx % CLASS_COLS;
    const row = Math.floor(idx / CLASS_COLS);
    const x = PAD + col * (classW + CLASS_GAP);
    const cy = y + row * (CLASS_H + CLASS_GAP);
    const weapons = WEAPONS.filter(w => w.class === cls);
    const done = weapons.filter(w => isWeaponMastered(w.name, progress)).length;
    const tierColor = highestCompleteTierColor(weapons, progress);

    ctx.fillStyle = PC_COLORS.panel;
    ctx.fillRect(x, cy, classW, CLASS_H);
    ctx.strokeStyle = tierColor || PC_COLORS.line;
    ctx.lineWidth = tierColor ? 2 : 1;
    ctx.strokeRect(x + 1, cy + 1, classW - 2, CLASS_H - 2);

    ctx.fillStyle = PC_COLORS.paper;
    ctx.font = '700 14px Barlow';
    ctx.fillText(classLabel(cls).toUpperCase(), x + 16, cy + 30);
    ctx.fillStyle = tierColor || '#fecf41';
    ctx.font = '700 22px "Stack Sans Headline"';
    ctx.fillText(done + '/' + weapons.length, x + 16, cy + 62);
  });

  y = y + classRows * (CLASS_H + CLASS_GAP) - CLASS_GAP + 50;

  // ---- Footer ----
  ctx.strokeStyle = PC_COLORS.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, y);
  ctx.lineTo(CARD_W - PAD, y);
  ctx.stroke();
  y += 34;

  const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  ctx.textAlign = 'left';
  ctx.fillStyle = PC_COLORS.dim;
  ctx.font = '400 15px Barlow';
  ctx.fillText('mw4-camo-tracker \u00b7 unofficial fan tracker \u00b7 ' + dateStr, PAD, y);

  const grindNames = loadGrindList();
  ctx.textAlign = 'right';
  let grindText;
  if(grindNames.length === 0){
    grindText = 'No weapons currently pinned';
  }else{
    const shown = grindNames.slice(0, 3).join(', ');
    grindText = 'Currently Grinding: ' + shown + (grindNames.length > 3 ? ' +' + (grindNames.length - 3) + ' more' : '');
  }
  ctx.fillText(grindText, CARD_W - PAD, y);

  return canvas;
}

// Wires up a "Download Progress Card" button anywhere on the site.
function initProgressCardButton(buttonId){
  const btn = document.getElementById(buttonId);
  if(!btn) return;
  const originalText = btn.textContent;

  btn.addEventListener('click', () => {
    btn.textContent = 'Generating\u2026';
    btn.disabled = true;

    generateProgressCardCanvas()
      .then(canvas => new Promise((resolve, reject) => {
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('toBlob returned null')), 'image/png');
      }))
      .then(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'mw4-camo-progress-' + new Date().toISOString().slice(0, 10) + '.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      })
      .catch(err => {
        console.error('Progress card generation failed:', err);
        alert('Could not generate the progress card image. Try again.');
      })
      .finally(() => {
        btn.textContent = originalText;
        btn.disabled = false;
      });
  });
}

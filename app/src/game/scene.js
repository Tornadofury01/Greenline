// Isometric (2.5D) farm scene with 4 plots, drawn with plain Canvas 2D (no game library, all art drawn here in code).
// What a plot shows comes ONLY from the player's setup (before the season) or from THAT plot's daily engine numbers:
//   live crop + stage + canopy -> plants (seed -> sprout -> tall -> ripe), never bare soil while a crop is growing
//   water stress -> wilting leaves      N supply share low -> yellow leaves      expected pest loss -> spots, then bugs
//   engine "bare" + no crop -> open soil; + soil lost vs T -> gullies; + dry -> blowing dust
//   residue -> straw-colored ground     irrigation today -> water spray            ledger tillage / harvest -> tractor / combine
// Weather (rain, heat > 95 F, red sun) is the same for all plots: it is one field with one weather record.
// draw(ctx, L, frame, scene) is a pure function of the frame plus a small particle list kept in `scene`.

export const P = 5;      // tiles per plot side
const G = 0.8;           // path between plots, in tiles
const S = 2 * P + G;     // whole field side
const HOT_C = 35;        // 95 F

const CROP_LOOK = {
  corn: { kind: 'stalk', h: 1.0, leaf: '#3f8f3a', ripe: '#c9a94b', head: '#e3c35a', seed: '#e3c35a' },
  grain_sorghum: { kind: 'stalk', h: 0.75, leaf: '#4a8f3a', ripe: '#b8873e', head: '#a4442b', seed: '#a4442b' },
  sorghum_sudangrass: { kind: 'stalk', h: 0.8, leaf: '#4f9a40', ripe: '#9c8a45', head: null, seed: '#8a6a3a' },
  winter_wheat: { kind: 'grass', h: 0.5, leaf: '#5aa04a', ripe: '#d8b552', head: '#d8b552', seed: '#d8b552' },
  cereal_rye: { kind: 'grass', h: 0.6, leaf: '#4f9a52', ripe: '#a99b55', head: null, seed: '#a99b55' },
  cotton: { kind: 'bush', h: 0.6, leaf: '#3d7f3d', ripe: '#6b6a3a', boll: '#f4f4ee', seed: '#f4f4ee' },
  soybeans: { kind: 'bush', h: 0.4, leaf: '#4f9a3f', ripe: '#b59a45', boll: null, seed: '#e0cf8a' },
  cowpea: { kind: 'bush', h: 0.35, leaf: '#5aa349', ripe: '#9b8a45', boll: null, seed: '#efe7d2' },
  alfalfa: { kind: 'bush', h: 0.35, leaf: '#4c9b54', ripe: '#4c9b54', boll: '#9a7fc9', seed: '#c9b45a' },
  crimson_clover: { kind: 'tuft', h: 0.25, leaf: '#4fa456', ripe: '#4fa456', boll: '#c2304a', seed: '#c2304a' },
  hairy_vetch: { kind: 'tuft', h: 0.25, leaf: '#4b9a5a', ripe: '#4b9a5a', boll: '#7d5bc0', seed: '#7d5bc0' },
  sunflower: { kind: 'flower', h: 0.95, leaf: '#4c8f39', ripe: '#8a7a3a', head: '#f2c230', seed: '#3a3a3a' },
  sesame: { kind: 'stalk', h: 0.6, leaf: '#5d9c45', ripe: '#a79459', head: '#efe7d2', seed: '#efe7d2' },
};

const mix = (a, b, t) => {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (s) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`;
};
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const hash = (i, j, s = 0) => { const x = Math.sin(i * 127.1 + j * 311.7 + s * 74.7) * 43758.5453; return x - Math.floor(x); };

export const plotOrigin = (i) => [(i % 2) * (P + G), Math.floor(i / 2) * (P + G)];

/** Screen layout for a canvas of w x h CSS px with free space `top` and `bottom` for the HUD and toolbar. */
export function layout(w, h, top, bottom) {
  const ah = Math.max(120, h - top - bottom);
  const tw = Math.max(16, Math.min((w - 20) / S, ah / (S / 2 + 2.0)));
  const th = tw / 2;
  const used = S * th + tw * 1.5;
  const ox = w / 2, oy = top + Math.max(0, (ah - used) / 2) + tw * 1.15;
  const iso = (x, y) => [ox + ((x - y) * tw) / 2, oy + ((x + y) * th) / 2];
  return { w, h, tw, th, ox, oy, iso };
}

/** Which plot (0-3) is under a screen point, or -1. Taps on the path between plots go to the nearest plot. */
export function plotAt(L, px, py) {
  const u = (px - L.ox) / (L.tw / 2), v = (py - L.oy) / (L.th / 2);
  const x = (u + v) / 2, y = (v - u) / 2;
  if (x < -0.6 || y < -0.6 || x > S + 0.6 || y > S + 0.6) return -1;
  const col = x < S / 2 ? 0 : 1, row = y < S / 2 ? 0 : 1;
  return row * 2 + col;
}

export const plotCenter = (L, i) => { const [x0, y0] = plotOrigin(i); return L.iso(x0 + P / 2, y0 + P / 2); };

export function createScene() {
  return { drops: [], dust: [], coins: [], sparks: [], lastT: 0 };
}

/** Coins flying from a plot to the coin counter (target in canvas px). */
export function spawnCoins(scene, L, plot, n, target, t, calm) {
  const [cx, cy] = plotCenter(L, plot);
  const count = calm ? Math.min(3, n) : n;
  for (let k = 0; k < count; k++) {
    scene.coins.push({ x0: cx + (hash(k, plot, 9) - 0.5) * L.tw * 2, y0: cy - L.th + (hash(plot, k, 8) - 0.5) * L.th * 2, tx: target[0], ty: target[1], t0: t + k * 0.07, dur: calm ? 0.5 : 0.9 });
  }
}

function polygon(ctx, pts) { ctx.beginPath(); pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); }

/**
 * frame = { mode: 'setup'|'season', plots: [pf x4], weather: { rain, tmax } | null, month, t, calm, selected, flag, accent }
 * pf (setup)  = { choice: {main, cover}, controls: {tillage, nScale, irrigation}, residue0, label }
 * pf (season) = { crop, stage, canopy, ground, residue, stress, nShare, pest, bare, erosSoFar, T, rzShare, irrigating, machine, label, tillage }
 */
export function draw(ctx, L, frame, scene) {
  const { w, h, tw, th, iso } = L;
  const wx = frame.weather;
  const hot = wx && wx.tmax >= HOT_C, wet = wx && wx.rain >= 1;
  const winter = frame.month <= 1 || frame.month >= 10;

  // sky + grass
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, wet ? '#6f7c88' : hot ? '#e2a67a' : winter ? '#93b8d2' : '#7fb3de');
  g.addColorStop(0.45, wet ? '#a9b3ba' : hot ? '#f3d7ac' : '#cfe6f2');
  g.addColorStop(0.46, winter ? '#86956a' : '#6f9a50');
  g.addColorStop(1, winter ? '#6f7d55' : '#5b8443');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  const sx = w - Math.max(36, tw * 1.4), sy = Math.max(70, L.oy - tw * 1.6), sr = Math.max(12, tw * 0.5);
  if (!wet) {
    ctx.fillStyle = hot ? '#e0442b' : '#ffd75e';
    ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.fill();
    if (hot) { ctx.strokeStyle = 'rgba(224,68,43,0.35)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(sx, sy, sr * 1.6, 0, Math.PI * 2); ctx.stroke(); }
  } else {
    ctx.fillStyle = 'rgba(90,100,110,0.9)';
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.ellipse(w * (0.15 + i * 0.24), sy - 10 + (i % 2) * 10, w * 0.13, tw * 0.6, 0, 0, Math.PI * 2); ctx.fill(); }
  }

  // field slab (2.5D sides)
  const pad = 0.5;
  const A = iso(-pad, -pad), B = iso(S + pad, -pad), C = iso(S + pad, S + pad), D = iso(-pad, S + pad);
  const depth = th * 0.8;
  ctx.fillStyle = '#5b3b22'; polygon(ctx, [D, C, [C[0], C[1] + depth], [D[0], D[1] + depth]]); ctx.fill();
  ctx.fillStyle = '#704a2b'; polygon(ctx, [C, B, [B[0], B[1] + depth], [C[0], C[1] + depth]]); ctx.fill();
  ctx.fillStyle = winter ? '#8c9a6a' : '#7fa85c'; polygon(ctx, [A, B, C, D]); ctx.fill();
  drawBarn(ctx, iso, tw, th);

  // plots, back to front: 0 (back), 1 and 2 (sides), 3 (front)
  for (const i of [0, 1, 2, 3]) drawPlot(ctx, L, i, frame.plots[i], frame, scene);
  for (const i of [0, 1, 2, 3]) drawPlotLabel(ctx, L, i, frame.plots[i], frame);

  // weather particles
  const dt = Math.min(0.05, Math.max(0, frame.t - scene.lastT)); scene.lastT = frame.t;
  const wantDrops = wet ? Math.min(frame.calm ? 40 : 160, Math.round(wx.rain * (frame.calm ? 3 : 8))) : 0;
  while (scene.drops.length < wantDrops) scene.drops.push({ x: Math.random() * w, y: Math.random() * h * 0.9 });
  scene.drops.length = Math.min(scene.drops.length, wantDrops);
  ctx.strokeStyle = 'rgba(210,230,255,0.85)'; ctx.lineWidth = 1.4;
  for (const p of scene.drops) {
    p.y += dt * h * 1.4; p.x -= dt * 30;
    if (p.y > h * 0.95) { p.y = -10; p.x = Math.random() * w; }
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - 2, p.y + 9); ctx.stroke();
  }
  if (hot) {
    ctx.strokeStyle = 'rgba(255,240,220,0.45)'; ctx.lineWidth = 2;
    for (let k = 0; k < 4; k++) {
      const y0 = L.oy - th - k * 10;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 12) {
        const y = y0 + Math.sin(x * 0.05 + (frame.calm ? 0 : frame.t * 6) + k) * 3;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  // coins flying to the counter
  scene.coins = scene.coins.filter((c) => frame.t < c.t0 + c.dur);
  for (const c of scene.coins) {
    const p = clamp01((frame.t - c.t0) / c.dur);
    if (p <= 0) continue;
    const e = p * p * (3 - 2 * p);
    const x = c.x0 + (c.tx - c.x0) * e, y = c.y0 + (c.ty - c.y0) * e - Math.sin(p * Math.PI) * tw * 1.5;
    const r = Math.max(5, tw * 0.2);
    ctx.fillStyle = '#f2c230'; ctx.strokeStyle = '#a77d12'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#a77d12'; ctx.fillRect(x - 1, y - r * 0.5, 2, r);
  }
}

function plotCorners(L, i, inset = 0) {
  const [x0, y0] = plotOrigin(i);
  return [L.iso(x0 + inset, y0 + inset), L.iso(x0 + P - inset, y0 + inset), L.iso(x0 + P - inset, y0 + P - inset), L.iso(x0 + inset, y0 + P - inset)];
}

function drawPlot(ctx, L, i, pf, frame, scene) {
  const { tw, th, iso } = L;
  const [x0, y0] = plotOrigin(i);
  const season = frame.mode === 'season';
  const live = season && pf.crop && CROP_LOOK[pf.crop];
  const tillage = season ? pf.tillage : pf.controls.tillage;
  const residue = clamp01(season ? pf.residue : pf.residue0 ?? 0.3);
  const wetDay = frame.weather && frame.weather.rain >= 1;

  // ground tiles: bare / plowed / straw; under a growing crop the soil is darkened by the canopy, never "open"
  const plowed = !season || (!live && residue < 0.35);
  const base = tillage === 'conventional' && plowed ? '#6b4428' : '#8a5a35';
  for (let a = 0; a < P; a++) for (let b = 0; b < P; b++) {
    let col = mix(base, '#b69a62', clamp01(residue * (tillage === 'no-till' ? 1.3 : 1.0)));
    if (wetDay) col = mix(col, '#5e3d25', 0.4);
    if (live) col = mix(col, '#4f7d3a', clamp01(pf.canopy * 0.8));
    const [px, py] = iso(x0 + a, y0 + b);
    ctx.fillStyle = col;
    polygon(ctx, [[px, py], [px + tw / 2, py + th / 2], [px, py + th], [px - tw / 2, py + th / 2]]); ctx.fill();
    // dry cracks only on open soil
    if (season && !live && pf.bare && pf.rzShare < 0.35 && hash(a + x0, b + y0) < 0.6) {
      ctx.strokeStyle = 'rgba(50,28,12,0.55)'; ctx.lineWidth = 1;
      const cx = px + (hash(a, b, 1) - 0.5) * tw * 0.4, cy = py + th * 0.5;
      ctx.beginPath(); ctx.moveTo(cx - tw * 0.16, cy); ctx.lineTo(cx, cy + th * 0.12); ctx.lineTo(cx + tw * 0.14, cy - th * 0.08); ctx.stroke();
    }
  }

  // furrows: plowed (conventional) or strip (reduced) lines along x
  if (plowed && tillage !== 'no-till') {
    ctx.strokeStyle = tillage === 'conventional' ? 'rgba(40,22,10,0.55)' : 'rgba(40,22,10,0.3)';
    ctx.lineWidth = tillage === 'conventional' ? 2 : 1.2;
    const rows = tillage === 'conventional' ? P * 2 : P;
    for (let r = 0; r < rows; r++) {
      const y = y0 + (r + 0.5) * (P / rows);
      const [ax, ay] = iso(x0 + 0.15, y), [bx, by] = iso(x0 + P - 0.15, y);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }
  }
  // straw bits on residue
  if (residue > 0.3 && !live) {
    ctx.strokeStyle = 'rgba(222,200,140,0.9)'; ctx.lineWidth = 1;
    for (let a = 0; a < P; a++) for (let b = 0; b < P; b++) {
      if (hash(a + x0, b + y0, 4) > residue) continue;
      const [px, py] = iso(x0 + a + 0.5, y0 + b + 0.5);
      ctx.beginPath(); ctx.moveTo(px - 3, py); ctx.lineTo(px + 2, py - 3); ctx.moveTo(px + 1, py + 2); ctx.lineTo(px + 5, py - 1); ctx.stroke();
    }
  }

  // gullies: only open soil that is losing soil (engine erosion so far this year vs the soil's tolerance T)
  if (season && !live && pf.bare && pf.T > 0) {
    const n = Math.min(4, Math.floor((4 * pf.erosSoFar) / pf.T));
    ctx.strokeStyle = 'rgba(45,25,12,0.85)'; ctx.lineCap = 'round';
    for (let k = 0; k < n; k++) {
      const yy = y0 + 0.8 + k * 1.1;
      ctx.lineWidth = 2 + (k % 2);
      ctx.beginPath();
      for (let s = 0; s <= 10; s++) {
        const [px, py] = iso(x0 + (s / 10) * P, yy + Math.sin(s * 0.9 + k + i) * 0.3);
        if (s === 0) ctx.moveTo(px, py + th / 2); else ctx.lineTo(px, py + th / 2);
      }
      ctx.stroke();
    }
  }

  // setup marks: fertilizer specks, seed rows, cover strip, irrigation pipe
  if (!season) {
    const fertN = Math.round(8 * (pf.controls.nScale ?? 1));
    if (pf.choice?.main && pf.choice.main !== 'fallow' && fertN > 0) {
      ctx.fillStyle = 'rgba(250,250,250,0.85)';
      for (let k = 0; k < fertN * 3; k++) {
        const [px, py] = iso(x0 + 0.3 + hash(k, i, 6) * (P - 0.6), y0 + 0.3 + hash(i, k, 7) * (P - 0.6));
        ctx.fillRect(px - 1, py - 1, 2, 2);
      }
    }
    const look = CROP_LOOK[pf.choice?.main];
    if (look) {
      for (let r = 0; r < P * 2; r++) for (let a = 0; a < P; a++) {
        const [px, py] = iso(x0 + a + 0.5, y0 + (r + 0.5) / 2);
        ctx.fillStyle = 'rgba(40,22,10,0.5)'; ctx.fillRect(px - 2, py, 4, 1.5);
        ctx.fillStyle = look.seed; ctx.beginPath(); ctx.arc(px, py - 1, Math.max(1.5, tw * 0.05), 0, Math.PI * 2); ctx.fill();
      }
    }
    const cover = CROP_LOOK[pf.choice?.cover];
    if (cover) {
      for (let a = 0; a < P * 2; a++) {
        const [px, py] = iso(x0 + (a + 0.5) / 2, y0 + 0.35);
        drawPlant(ctx, cover, px, py, tw, 0.8, 0, cover.leaf, frame.t, true, 0);
      }
    }
  }
  if ((season ? pf.irrigationOn : pf.controls.irrigation !== 'none')) {
    const [ax, ay] = iso(x0 + P - 0.1, y0 + 0.1), [bx, by] = iso(x0 + P - 0.1, y0 + P - 0.1);
    ctx.strokeStyle = '#2b78c4'; ctx.lineWidth = Math.max(3, tw * 0.1); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    if (season && pf.irrigating) {
      ctx.fillStyle = 'rgba(120,190,255,0.8)';
      for (let k = 0; k < (frame.calm ? 6 : 18); k++) {
        const s = hash(k, i, Math.floor(frame.t * 6));
        const [px, py] = iso(x0 + P - 0.3 - s * 1.6, y0 + hash(i, k, 2) * P);
        ctx.beginPath(); ctx.arc(px, py - tw * 0.3 * s, 1.6, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  // plants from this plot's own day numbers
  if (live) {
    const look = CROP_LOOK[pf.crop];
    // A crop in the ground is never drawn as bare soil: at least seed / sprout size while the engine says it is there.
    const grow = Math.max(0.06, clamp01(Math.max(pf.stage, pf.canopy)));
    const ripe = clamp01((pf.stage - 0.8) / 0.2);
    const wilt = clamp01((pf.stress - 0.3) / 0.6);
    const yellow = clamp01((0.85 - pf.nShare) / 0.35);
    let leaf = mix(look.leaf, '#d9cf45', yellow * 0.8);
    leaf = mix(leaf, '#a58a45', wilt * 0.6);
    leaf = mix(leaf, look.ripe, ripe);
    for (let r = 0; r < P * 2; r++) for (let a = 0; a < P; a++) {
      const [px, py] = iso(x0 + a + 0.5, y0 + (r + 0.5) / 2);
      const jitter = 0.85 + hash(a + x0, r + y0, 3) * 0.3;
      drawPlant(ctx, look, px, py + th * 0.1, tw, grow * jitter, ripe, leaf, frame.t, frame.calm, wilt);
    }
    // pests: brown spots from 4 % expected loss, crawling bugs from 8 %
    if (pf.pest >= 0.04) {
      for (let k = 0; k < 14; k++) {
        const [px, py] = iso(x0 + 0.4 + hash(k, i, 11) * (P - 0.8), y0 + 0.4 + hash(i, k, 12) * (P - 0.8));
        const hh = tw * 0.6 * look.h * grow;
        ctx.fillStyle = '#6b3b1a'; ctx.beginPath(); ctx.arc(px + 2, py - hh * 0.5, 1.8, 0, Math.PI * 2); ctx.arc(px - 2, py - hh * 0.3, 1.4, 0, Math.PI * 2); ctx.fill();
        if (pf.pest >= 0.08 && k % 2 === 0) {
          const m = frame.calm ? 0 : Math.sin(frame.t * 3 + k) * 3;
          ctx.fillStyle = '#1d1d1d'; ctx.beginPath(); ctx.ellipse(px + m, py - hh * 0.7, 2.4, 1.6, 0, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
  }

  // blowing dust: open, dry soil without rain today
  if (season && !live && pf.bare && pf.rzShare < 0.5 && !wetDay && !frame.calm) {
    const [cx, cy] = plotCenter(L, i);
    ctx.fillStyle = 'rgba(170,120,75,0.35)';
    for (let k = 0; k < 10; k++) {
      const p = (frame.t * 0.4 + hash(k, i, 3)) % 1;
      ctx.beginPath(); ctx.arc(cx - tw * 2 + p * tw * 4, cy - th * 0.6 - p * th + hash(k, i, 5) * th, 2 + hash(k, i, 1) * 3, 0, Math.PI * 2); ctx.fill();
    }
  }

  if (season && pf.machine) drawMachine(ctx, L, i, pf.machine);

  // outline: every plot, thick accent when selected, pulsing ring when an event points here
  const corners = plotCorners(L, i, -0.06);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.5; polygon(ctx, corners); ctx.stroke();
  if (frame.selected === i) { ctx.strokeStyle = frame.accent || '#c8f05a'; ctx.lineWidth = 4; polygon(ctx, corners); ctx.stroke(); }
  if (frame.flag === i) {
    const pulse = frame.calm ? 0.5 : (Math.sin(frame.t * 6) + 1) / 2;
    ctx.strokeStyle = `rgba(255,90,60,${0.5 + pulse * 0.5})`; ctx.lineWidth = 3 + pulse * 2; polygon(ctx, plotCorners(L, i, -0.2)); ctx.stroke();
  }
}

function drawPlotLabel(ctx, L, i, pf, frame) {
  const [x0, y0] = plotOrigin(i);
  const [px, py] = L.iso(x0 + P, y0 + P);   // the plot's front corner
  const text = pf.label ?? String(i + 1);
  ctx.font = '700 12px system-ui, sans-serif';
  const tw = ctx.measureText(text).width;
  const bw = tw + 30, bh = 22, bx = Math.max(4, Math.min(L.w - bw - 4, px - bw / 2)), by = py - bh / 2;
  ctx.fillStyle = frame.selected === i ? (frame.accent || '#c8f05a') : 'rgba(15,25,18,0.82)';
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, by, bw, bh, 11) : ctx.rect(bx, by, bw, bh); ctx.fill();
  ctx.fillStyle = frame.selected === i ? '#14200f' : '#fff';
  ctx.beginPath(); ctx.arc(bx + 11, by + 11, 8, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = frame.selected === i ? (frame.accent || '#c8f05a') : '#14200f';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(i + 1), bx + 11, by + 11.5);
  ctx.fillStyle = frame.selected === i ? '#14200f' : '#fff';
  ctx.textAlign = 'left';
  ctx.fillText(text, bx + 24, by + 11.5);
}

function drawPlant(ctx, look, x, y, tw, grow, ripe, leaf, t, calm, wilt) {
  if (grow <= 0.02) return;
  const H = tw * 0.95 * look.h * grow * (1 - wilt * 0.25);
  const sway = calm ? 0 : Math.sin(t * 2 + x * 0.05) * 1.2;
  const droop = wilt * tw * 0.12;
  ctx.lineCap = 'round';
  if (grow < 0.08) { // seed in the row
    ctx.fillStyle = look.seed; ctx.beginPath(); ctx.arc(x, y - 1, Math.max(1.5, tw * 0.05), 0, Math.PI * 2); ctx.fill();
    return;
  }
  if (grow < 0.16) { // sprout
    ctx.strokeStyle = leaf; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 4); ctx.stroke();
    ctx.fillStyle = leaf; ctx.beginPath(); ctx.ellipse(x - 2, y - 4, 2.2, 1.2, -0.5, 0, Math.PI * 2); ctx.ellipse(x + 2, y - 4, 2.2, 1.2, 0.5, 0, Math.PI * 2); ctx.fill();
    return;
  }
  if (look.kind === 'stalk' || look.kind === 'flower') {
    ctx.strokeStyle = leaf; ctx.lineWidth = Math.max(1.5, tw * 0.05);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + sway, y - H * 0.6, x + sway + droop, y - H); ctx.stroke();
    ctx.lineWidth = Math.max(1, tw * 0.035);
    for (let k = 1; k <= 3; k++) {
      const yy = y - H * (k / 4), dir = k % 2 ? 1 : -1;
      ctx.beginPath(); ctx.moveTo(x + sway * (k / 4), yy); ctx.quadraticCurveTo(x + dir * tw * 0.12, yy - 3 + droop, x + dir * tw * 0.17, yy + 3 + droop * 1.5); ctx.stroke();
    }
    if (look.head && grow > 0.6) {
      ctx.fillStyle = look.kind === 'flower' && ripe > 0.5 ? '#8a6a25' : look.head;
      const r = look.kind === 'flower' ? tw * 0.11 : tw * 0.06;
      ctx.beginPath(); ctx.ellipse(x + sway + droop, y - H - r * 0.4, r, look.kind === 'flower' ? r : r * 1.6, 0, 0, Math.PI * 2); ctx.fill();
    }
  } else if (look.kind === 'grass') {
    ctx.strokeStyle = leaf; ctx.lineWidth = 1.2;
    for (let k = -2; k <= 2; k++) {
      ctx.beginPath(); ctx.moveTo(x + k, y); ctx.lineTo(x + k * 2.2 + sway + droop * Math.sign(k || 1), y - H * (0.8 + Math.abs(k) * 0.05)); ctx.stroke();
    }
    if (look.head && grow > 0.6) {
      ctx.fillStyle = look.head;
      for (let k = -2; k <= 2; k += 2) { ctx.beginPath(); ctx.ellipse(x + k * 2.2 + sway, y - H * 0.85, 1.6, 4, 0, 0, Math.PI * 2); ctx.fill(); }
    }
  } else { // bush, tuft
    const r = Math.max(2, tw * (look.kind === 'tuft' ? 0.12 : 0.17) * grow);
    ctx.fillStyle = leaf;
    ctx.beginPath(); ctx.ellipse(x, y - r * 0.8 + droop * 0.3, r * (1.2 + wilt * 0.2), r * (1 - wilt * 0.3), 0, 0, Math.PI * 2); ctx.fill();
    if (look.boll && (look.kind === 'tuft' ? grow > 0.5 : ripe > 0.2)) {
      ctx.fillStyle = look.boll;
      for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(x - r * 0.6 + k * r * 0.6, y - r * (1.1 + (k % 2) * 0.4), Math.max(1.4, r * 0.25), 0, Math.PI * 2); ctx.fill(); }
    }
  }
}

function drawBarn(ctx, iso, tw, th) {
  const [x, y] = iso(-0.4, -1.2);
  const W = tw * 1.2, H = tw * 0.85;
  ctx.fillStyle = '#9b2f24'; ctx.fillRect(x - W / 2, y - H, W, H);
  ctx.fillStyle = '#7a241b'; polygon(ctx, [[x + W / 2, y - H], [x + W / 2 + W * 0.35, y - H - th * 0.4], [x + W / 2 + W * 0.35, y - th * 0.4], [x + W / 2, y]]); ctx.fill();
  ctx.fillStyle = '#4d4d4d'; polygon(ctx, [[x - W / 2 - 4, y - H], [x, y - H - H * 0.55], [x + W / 2 + 4, y - H]]); ctx.fill();
  ctx.fillStyle = '#5c5c5c'; polygon(ctx, [[x + W / 2 + 4, y - H], [x, y - H - H * 0.55], [x + W * 0.35, y - H - H * 0.55 - th * 0.4], [x + W / 2 + W * 0.35 + 4, y - H - th * 0.4]]); ctx.fill();
  ctx.strokeStyle = '#f2e6d0'; ctx.lineWidth = 2;
  ctx.strokeRect(x - W * 0.2, y - H * 0.6, W * 0.4, H * 0.6);
  ctx.beginPath(); ctx.moveTo(x - W * 0.2, y - H * 0.6); ctx.lineTo(x + W * 0.2, y); ctx.moveTo(x + W * 0.2, y - H * 0.6); ctx.lineTo(x - W * 0.2, y); ctx.stroke();
}

// A machine drives the plot row by row: m = { kind: 'tractor' | 'combine', p: 0..1 }
function drawMachine(ctx, L, i, m) {
  const [x0, y0] = plotOrigin(i);
  const rows = 4, p = clamp01(m.p);
  const row = Math.min(rows - 1, Math.floor(p * rows)), q = (p * rows) % 1;
  const x = x0 + (row % 2 ? 1 - q : q) * P, y = y0 + (row + 0.5) * (P / rows);
  const [px, py] = L.iso(x, y);
  const s = L.tw * 0.55;
  const body = m.kind === 'combine' ? '#d7b02c' : '#2f7a3a';
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(px, py + 2, s * 0.9, s * 0.35, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = body; ctx.fillRect(px - s * 0.6, py - s * 0.7, s * 1.2, s * 0.55);
  ctx.fillStyle = '#26323a'; ctx.fillRect(px - s * 0.1, py - s * 1.15, s * 0.45, s * 0.45);
  ctx.fillStyle = '#1c1c1c';
  ctx.beginPath(); ctx.arc(px - s * 0.4, py - s * 0.1, s * 0.28, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(px + s * 0.42, py - s * 0.08, s * 0.18, 0, Math.PI * 2); ctx.fill();
  if (m.kind === 'combine') { ctx.fillStyle = '#b08d1f'; ctx.fillRect(px + s * 0.6, py - s * 0.45, s * 0.55, s * 0.25); }
  else { ctx.strokeStyle = '#555'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(px - s * 0.6, py - s * 0.3); ctx.lineTo(px - s * 1.0, py - s * 0.1); ctx.stroke(); }
}

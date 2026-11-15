// Isometric (2.5D) farm scene, drawn with plain Canvas 2D (no game library: nothing extra to download, small chunk).
// All art is simple shapes drawn here. What it shows comes ONLY from the engine's daily numbers for the year being played:
//   crop + stage + canopy -> plants (each crop its own shape)      rain -> rain drops, grey sky
//   tmax >= 35 C (95 F)    -> red sun + heat shimmer                root-zone water low -> cracked soil
//   ground cover low       -> bare brown soil, blowing dust          residue -> straw-colored soil
//   erosion so far vs T    -> gullies                                tillage / harvest events -> tractor / combine passes
// draw(ctx, w, h, frame) is a pure function of `frame` plus a small particle list kept in the scene object.

const N = 8; // tiles per side
const HOT_C = 35; // 95 F

const CROP_LOOK = {
  corn: { kind: 'stalk', h: 1.0, leaf: '#3f8f3a', ripe: '#c9a94b', head: '#e3c35a' },
  grain_sorghum: { kind: 'stalk', h: 0.75, leaf: '#4a8f3a', ripe: '#b8873e', head: '#a4442b' },
  sorghum_sudangrass: { kind: 'stalk', h: 0.8, leaf: '#4f9a40', ripe: '#9c8a45', head: null },
  winter_wheat: { kind: 'grass', h: 0.5, leaf: '#5aa04a', ripe: '#d8b552', head: '#d8b552' },
  cereal_rye: { kind: 'grass', h: 0.6, leaf: '#4f9a52', ripe: '#a99b55', head: null },
  cotton: { kind: 'bush', h: 0.6, leaf: '#3d7f3d', ripe: '#6b6a3a', boll: '#f4f4ee' },
  soybeans: { kind: 'bush', h: 0.4, leaf: '#4f9a3f', ripe: '#b59a45', boll: null },
  cowpea: { kind: 'bush', h: 0.35, leaf: '#5aa349', ripe: '#9b8a45', boll: null },
  alfalfa: { kind: 'bush', h: 0.35, leaf: '#4c9b54', ripe: '#4c9b54', boll: '#9a7fc9' },
  crimson_clover: { kind: 'tuft', h: 0.25, leaf: '#4fa456', ripe: '#4fa456', boll: '#c2304a' },
  hairy_vetch: { kind: 'tuft', h: 0.25, leaf: '#4b9a5a', ripe: '#4b9a5a', boll: '#7d5bc0' },
  sunflower: { kind: 'flower', h: 0.95, leaf: '#4c8f39', ripe: '#8a7a3a', head: '#f2c230' },
  sesame: { kind: 'stalk', h: 0.6, leaf: '#5d9c45', ripe: '#a79459', head: '#efe7d2' },
};

const mix = (a, b, t) => {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (s) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
};
const clamp01 = (x) => Math.max(0, Math.min(1, x));
// Fixed pseudo-random per tile, so cracks and plants do not jump between frames.
const hash = (i, j, s = 0) => { const x = Math.sin(i * 127.1 + j * 311.7 + s * 74.7) * 43758.5453; return x - Math.floor(x); };

export function createScene() {
  return { drops: [], dust: [], lastT: 0 };
}

/**
 * frame = { d: day record {rain,tmax,rz,rzCap,stress,canopy,ground,residue,stage}, crop, month (0-11), erosSoFar, T,
 *           machine: { kind: 'tractor'|'combine', p: 0..1 } | null, pop: { text, p } | null, sign: string, t (seconds),
 *           calm (reduced motion), dark }
 */
export function draw(ctx, w, h, frame, scene) {
  const { d, calm } = frame;
  const hot = d.tmax >= HOT_C, wet = d.rain >= 1;
  const tw = Math.min(w * 0.72, h * 1.25) / N, th = tw / 2;
  const ox = w * 0.5, oy = h * 0.36;
  const iso = (x, y) => [ox + (x - y) * tw / 2, oy + (x + y) * th / 2];

  // 1 sky
  const winter = frame.month <= 1 || frame.month >= 10;
  const top = wet ? '#7d8a96' : hot ? '#e9b98a' : winter ? '#9fc3dc' : '#7fb8e6';
  const bottom = wet ? '#b9c2c9' : hot ? '#f6dfb8' : '#d7ecf7';
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, top); g.addColorStop(0.6, bottom); g.addColorStop(1, bottom);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

  // 2 sun (red on days over 95 F) or clouds when it rains
  const sx = w * 0.85, sy = h * 0.14, sr = Math.max(14, w * 0.045);
  if (!wet) {
    ctx.fillStyle = hot ? '#e0442b' : '#ffd75e';
    ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.fill();
    if (hot) { ctx.strokeStyle = 'rgba(224,68,43,0.35)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(sx, sy, sr * 1.5, 0, Math.PI * 2); ctx.stroke(); }
  } else {
    ctx.fillStyle = 'rgba(95,105,115,0.9)';
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.ellipse(w * (0.2 + i * 0.2), h * 0.1 + (i % 2) * 10, w * 0.12, h * 0.05, 0, 0, Math.PI * 2); ctx.fill(); }
  }

  // 3 ground slab (2.5D sides), then fence and barn behind the plot
  const [ax, ay] = iso(0, 0), [bx, by] = iso(N, 0), [cx, cy] = iso(N, N), [dx, dy] = iso(0, N);
  const depth = th * 0.9;
  ctx.fillStyle = '#5b3b22';
  ctx.beginPath(); ctx.moveTo(dx, dy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + depth); ctx.lineTo(dx, dy + depth); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#704a2b';
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(bx, by); ctx.lineTo(bx, by + depth); ctx.lineTo(cx, cy + depth); ctx.closePath(); ctx.fill();
  // grass border around the plot
  ctx.fillStyle = winter ? '#8c9a6a' : '#7aa45a';
  const pad = 0.6;
  const [gx1, gy1] = iso(-pad, -pad), [gx2, gy2] = iso(N + pad, -pad), [gx3, gy3] = iso(N + pad, N + pad), [gx4, gy4] = iso(-pad, N + pad);
  ctx.beginPath(); ctx.moveTo(gx1, gy1); ctx.lineTo(gx2, gy2); ctx.lineTo(gx3, gy3); ctx.lineTo(gx4, gy4); ctx.closePath(); ctx.fill();
  drawBarn(ctx, iso, tw, th);
  drawFence(ctx, iso, th);

  // 4 soil tiles
  const cover = clamp01(d.ground), residue = clamp01(d.residue), canopy = clamp01(d.canopy);
  const dry = d.rzCap > 0 ? d.rz / d.rzCap : 1;
  const bare = '#8a5a35', straw = '#b69a62', wetSoil = '#5e3d25';
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    let col = mix(bare, straw, clamp01(residue * 1.2));
    if (wet) col = mix(col, wetSoil, 0.45);
    if (canopy > 0.05) col = mix(col, '#4f7d3a', clamp01(canopy * 0.8));
    const [px, py] = iso(i, j);
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + tw / 2, py + th / 2); ctx.lineTo(px, py + th); ctx.lineTo(px - tw / 2, py + th / 2); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.08)'; ctx.lineWidth = 1; ctx.stroke();
    // cracked dry soil when the root zone is low on water and the ground is mostly open
    if (dry < 0.35 && canopy < 0.6 && hash(i, j) < 0.7) {
      ctx.strokeStyle = 'rgba(50,28,12,0.55)'; ctx.lineWidth = 1;
      ctx.beginPath();
      const cx0 = px + (hash(i, j, 1) - 0.5) * tw * 0.4, cy0 = py + th * 0.5 + (hash(i, j, 2) - 0.5) * th * 0.4;
      ctx.moveTo(cx0 - tw * 0.18, cy0); ctx.lineTo(cx0, cy0 + th * 0.12); ctx.lineTo(cx0 + tw * 0.15, cy0 - th * 0.08);
      ctx.moveTo(cx0, cy0 + th * 0.12); ctx.lineTo(cx0 + tw * 0.04, cy0 + th * 0.3);
      ctx.stroke();
    }
  }

  // 5 gullies: one per 25% of the soil loss tolerance T used so far this year (max 6)
  const gullies = frame.T > 0 ? Math.min(6, Math.floor((4 * frame.erosSoFar) / frame.T)) : 0;
  ctx.strokeStyle = 'rgba(45,25,12,0.8)'; ctx.lineCap = 'round';
  for (let k = 0; k < gullies; k++) {
    const j0 = 1 + ((k * 3) % (N - 1));
    ctx.lineWidth = 2 + (k % 2);
    ctx.beginPath();
    for (let s = 0; s <= 16; s++) {
      const x = (s / 16) * N, y = j0 + Math.sin(s * 0.9 + k) * 0.35;
      const [px, py] = iso(x, y);
      if (s === 0) ctx.moveTo(px, py + th / 2); else ctx.lineTo(px, py + th / 2);
    }
    ctx.stroke();
  }

  // 6 plants, back to front
  const look = CROP_LOOK[frame.crop];
  if (look) {
    const grow = clamp01(Math.max(d.stage, canopy));
    const ripe = clamp01((d.stage - 0.8) / 0.2);
    const stressed = clamp01(d.stress);
    const leaf = mix(mix(look.leaf, '#b8a24a', stressed * 0.6), look.ripe, ripe);
    for (let s = 0; s < N * 2; s++) for (let i = 0; i < N; i++) {
      const j = s / 2 + 0.25;
      if (j >= N) continue;
      const [px, py] = iso(i + 0.5, j);
      const jitter = 0.85 + hash(i, s, 3) * 0.3;
      drawPlant(ctx, look, px, py + th * 0.25, tw, grow * jitter, ripe, leaf, frame.t, calm);
    }
  } else if (residue > 0.3) {
    ctx.strokeStyle = 'rgba(214,190,130,0.9)'; ctx.lineWidth = 1;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const [px, py] = iso(i + 0.5, j + 0.5);
      ctx.beginPath(); ctx.moveTo(px - 3, py); ctx.lineTo(px + 2, py - 4); ctx.moveTo(px + 1, py + 1); ctx.lineTo(px + 5, py - 3); ctx.stroke();
    }
  }

  // 6b fit-check marks on the plants: spotted leaves (disease check warns), frost specks (season check fails or a frost kill)
  if (look && (frame.spots || frame.frost)) {
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      if (hash(i, j, 5) > 0.45) continue;
      const [px, py] = iso(i + 0.5, j + 0.5);
      const hh = tw * 0.5 * look.h * clamp01(Math.max(d.stage, canopy));
      if (frame.spots) { ctx.fillStyle = '#6b3b1a'; ctx.beginPath(); ctx.arc(px + 2, py - hh * 0.5, 1.8, 0, Math.PI * 2); ctx.arc(px - 2, py - hh * 0.3, 1.5, 0, Math.PI * 2); ctx.fill(); }
      if (frame.frost) { ctx.fillStyle = 'rgba(240,248,255,0.9)'; ctx.beginPath(); ctx.arc(px - 1, py - hh * 0.6, 1.6, 0, Math.PI * 2); ctx.arc(px + 3, py - hh * 0.2, 1.3, 0, Math.PI * 2); ctx.fill(); }
    }
  }

  // 7 machine pass (tractor for tillage, combine at harvest)
  if (frame.machine) drawMachine(ctx, iso, tw, th, frame.machine);

  // 8 sign with county and acres
  if (frame.sign) {
    const [px, py] = iso(N + 0.3, N + 0.9);
    ctx.font = `600 ${Math.max(12, Math.round(tw * 0.32))}px system-ui, sans-serif`;
    const tw2 = ctx.measureText(frame.sign).width + 14;
    ctx.fillStyle = '#6b4a2a'; ctx.fillRect(px - 2, py - 4, 4, 22);
    ctx.fillStyle = '#f3ead8'; ctx.strokeStyle = '#6b4a2a'; ctx.lineWidth = 2;
    ctx.fillRect(px - tw2 + 10, py - 26, tw2, 24); ctx.strokeRect(px - tw2 + 10, py - 26, tw2, 24);
    ctx.fillStyle = '#3a2a18'; ctx.textBaseline = 'middle'; ctx.fillText(frame.sign, px - tw2 + 17, py - 14);
  }

  // 9 weather particles
  const dt = Math.min(0.05, Math.max(0, frame.t - scene.lastT)); scene.lastT = frame.t;
  const wantDrops = wet ? Math.min(calm ? 40 : 160, Math.round(d.rain * (calm ? 3 : 8))) : 0;
  while (scene.drops.length < wantDrops) scene.drops.push({ x: Math.random() * w, y: Math.random() * h * 0.9 });
  scene.drops.length = Math.min(scene.drops.length, wantDrops);
  ctx.strokeStyle = 'rgba(210,230,255,0.85)'; ctx.lineWidth = 1.4;
  for (const p of scene.drops) {
    p.y += dt * h * 1.4; p.x -= dt * 30;
    if (p.y > h * 0.95) { p.y = -10; p.x = Math.random() * w; }
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - 2, p.y + 9); ctx.stroke();
  }
  const dusty = !wet && cover < 0.25 && dry < 0.5;
  const wantDust = dusty ? (calm ? 10 : 45) : 0;
  while (scene.dust.length < wantDust) scene.dust.push({ x: Math.random() * w, y: oy + Math.random() * th * N, a: Math.random() });
  scene.dust.length = Math.min(scene.dust.length, wantDust);
  ctx.fillStyle = 'rgba(160,110,70,0.45)';
  for (const p of scene.dust) {
    p.x += dt * (calm ? 30 : 90); p.y -= dt * 8;
    if (p.x > w + 10) { p.x = -10; p.y = oy + Math.random() * th * N; }
    ctx.beginPath(); ctx.arc(p.x, p.y, 2 + p.a * 3, 0, Math.PI * 2); ctx.fill();
  }

  // 10 heat shimmer
  if (hot) {
    ctx.strokeStyle = 'rgba(255,240,220,0.45)'; ctx.lineWidth = 2;
    for (let k = 0; k < 5; k++) {
      const y0 = oy - th * 0.5 - k * 10;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 12) {
        const y = y0 + Math.sin(x * 0.05 + (calm ? 0 : frame.t * 6) + k) * 3;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  // 11 money pop at harvest
  if (frame.pop) {
    const p = frame.pop.p;
    ctx.globalAlpha = 1 - p * 0.8;
    ctx.font = `800 ${Math.max(18, Math.round(w * 0.05))}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(20,40,25,0.85)'; ctx.strokeText(frame.pop.text, ox, oy + th * 2 - p * 50);
    ctx.fillStyle = frame.pop.text.startsWith('-') || frame.pop.text.startsWith('−') ? '#ffb4a0' : '#d8ff7a';
    ctx.fillText(frame.pop.text, ox, oy + th * 2 - p * 50);
    ctx.globalAlpha = 1; ctx.textAlign = 'start';
  }
}

function drawPlant(ctx, look, x, y, tw, grow, ripe, leaf, t, calm) {
  if (grow <= 0.02) return;
  const H = tw * 1.1 * look.h * grow;
  const sway = calm ? 0 : Math.sin(t * 2 + x * 0.05) * 1.2;
  ctx.lineCap = 'round';
  if (grow < 0.12) { // sprout
    ctx.fillStyle = leaf; ctx.beginPath(); ctx.ellipse(x, y - 2, 2, 3, 0, 0, Math.PI * 2); ctx.fill(); return;
  }
  if (look.kind === 'stalk' || look.kind === 'flower') {
    ctx.strokeStyle = leaf; ctx.lineWidth = Math.max(1.5, tw * 0.05);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + sway, y - H); ctx.stroke();
    ctx.lineWidth = Math.max(1, tw * 0.035);
    for (let k = 1; k <= 3; k++) {
      const yy = y - H * (k / 4), dir = k % 2 ? 1 : -1;
      ctx.beginPath(); ctx.moveTo(x + sway * (k / 4), yy); ctx.quadraticCurveTo(x + dir * tw * 0.12, yy - 3, x + dir * tw * 0.18, yy + 3); ctx.stroke();
    }
    if (look.head && grow > 0.6) {
      ctx.fillStyle = look.kind === 'flower' && ripe > 0.5 ? '#8a6a25' : look.head;
      const r = look.kind === 'flower' ? tw * 0.11 : tw * 0.06;
      ctx.beginPath(); ctx.ellipse(x + sway, y - H - r * 0.4, r, look.kind === 'flower' ? r : r * 1.6, 0, 0, Math.PI * 2); ctx.fill();
    }
  } else if (look.kind === 'grass') {
    ctx.strokeStyle = leaf; ctx.lineWidth = 1.2;
    for (let k = -2; k <= 2; k++) {
      ctx.beginPath(); ctx.moveTo(x + k, y); ctx.lineTo(x + k * 2.2 + sway, y - H * (0.8 + Math.abs(k) * 0.05)); ctx.stroke();
    }
    if (look.head && grow > 0.6) {
      ctx.fillStyle = look.head;
      for (let k = -2; k <= 2; k += 2) { ctx.beginPath(); ctx.ellipse(x + k * 2.2 + sway, y - H * 0.85, 1.6, 4, 0, 0, Math.PI * 2); ctx.fill(); }
    }
  } else { // bush, tuft
    const r = Math.max(2, tw * (look.kind === 'tuft' ? 0.12 : 0.17) * grow);
    ctx.fillStyle = leaf;
    ctx.beginPath(); ctx.ellipse(x, y - r * 0.8, r * 1.2, r, 0, 0, Math.PI * 2); ctx.fill();
    if (look.boll && (look.kind === 'tuft' ? grow > 0.5 : ripe > 0.2)) {
      ctx.fillStyle = look.boll;
      for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(x - r * 0.6 + k * r * 0.6, y - r * (1.1 + (k % 2) * 0.4), Math.max(1.4, r * 0.25), 0, Math.PI * 2); ctx.fill(); }
    }
  }
}

function drawBarn(ctx, iso, tw, th) {
  const [x, y] = iso(-0.2, -1.6);
  const W = tw * 1.4, H = tw * 1.0;
  ctx.fillStyle = '#9b2f24'; ctx.fillRect(x - W / 2, y - H, W, H);
  ctx.fillStyle = '#7a241b'; ctx.beginPath(); ctx.moveTo(x + W / 2, y - H); ctx.lineTo(x + W / 2 + W * 0.35, y - H - th * 0.4); ctx.lineTo(x + W / 2 + W * 0.35, y - th * 0.4); ctx.lineTo(x + W / 2, y); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#4d4d4d'; ctx.beginPath(); ctx.moveTo(x - W / 2 - 4, y - H); ctx.lineTo(x, y - H - H * 0.55); ctx.lineTo(x + W / 2 + 4, y - H); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x + W / 2 + 4, y - H); ctx.lineTo(x, y - H - H * 0.55); ctx.lineTo(x + W * 0.35, y - H - H * 0.55 - th * 0.4); ctx.lineTo(x + W / 2 + W * 0.35 + 4, y - H - th * 0.4); ctx.closePath(); ctx.fillStyle = '#5c5c5c'; ctx.fill();
  ctx.strokeStyle = '#f2e6d0'; ctx.lineWidth = 2;
  ctx.strokeRect(x - W * 0.2, y - H * 0.6, W * 0.4, H * 0.6);
  ctx.beginPath(); ctx.moveTo(x - W * 0.2, y - H * 0.6); ctx.lineTo(x + W * 0.2, y); ctx.moveTo(x + W * 0.2, y - H * 0.6); ctx.lineTo(x - W * 0.2, y); ctx.stroke();
}

function drawFence(ctx, iso, th) {
  ctx.strokeStyle = '#d9c7a3'; ctx.lineWidth = 2;
  const post = (x, y) => { const [px, py] = iso(x, y); ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py - th * 0.6); ctx.stroke(); };
  const rail = (a, b, k) => { const [x1, y1] = iso(...a), [x2, y2] = iso(...b); ctx.beginPath(); ctx.moveTo(x1, y1 - th * k); ctx.lineTo(x2, y2 - th * k); ctx.stroke(); };
  const e = -0.4, f = 8.4;
  for (let s = 0; s <= 8; s++) { post(e + s * ((f - e) / 8), e); post(e, e + s * ((f - e) / 8)); }
  rail([e, e], [f, e], 0.25); rail([e, e], [f, e], 0.5); rail([e, e], [e, f], 0.25); rail([e, e], [e, f], 0.5);
}

function drawMachine(ctx, iso, tw, th, m) {
  const row = 1 + Math.floor(m.p * 6) % 6;
  const x = (m.p * 6 % 1) * 8;
  const [px, py] = iso(x, row + 0.5);
  const s = tw * 0.5;
  const body = m.kind === 'combine' ? '#d7b02c' : '#2f7a3a';
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(px, py + 2, s * 0.9, s * 0.35, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = body; ctx.fillRect(px - s * 0.6, py - s * 0.7, s * 1.2, s * 0.55);
  ctx.fillStyle = '#26323a'; ctx.fillRect(px - s * 0.1, py - s * 1.15, s * 0.45, s * 0.45);
  ctx.fillStyle = '#1c1c1c';
  ctx.beginPath(); ctx.arc(px - s * 0.4, py - s * 0.1, s * 0.28, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(px + s * 0.42, py - s * 0.08, s * 0.18, 0, Math.PI * 2); ctx.fill();
  if (m.kind === 'combine') { ctx.fillStyle = '#b08d1f'; ctx.fillRect(px + s * 0.6, py - s * 0.45, s * 0.5, s * 0.25); }
  else { ctx.strokeStyle = '#555'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(px - s * 0.6, py - s * 0.3); ctx.lineTo(px - s * 1.0, py - s * 0.1); ctx.stroke(); }
}

import * as THREE from 'three';

/**
 * Canvas-authored road textures.
 *
 * Drawn at runtime rather than shipped as PNGs so the whole game stays a single
 * deployable with no asset pipeline, and so lane count changes in `Balance.ts`
 * regenerate correct markings instead of silently disagreeing with a baked
 * image.
 */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable — cannot author road textures');
  return [c, ctx];
}

/** Asphalt with lane dashes, solid edges and a worn centre. One tile = one segment. */
export function makeRoadTexture(laneCount: number, repeatY: number): THREE.Texture {
  const W = 512;
  const H = 512;
  const [c, ctx] = canvas(W, H);

  // Sun-bleached, not fresh-laid. The previous value came from "real asphalt
  // in daylight sits around 20% grey", which is true of new asphalt and wrong
  // for the road this game is set on: a coastal highway that has been in the
  // sun for years is pale, closer to concrete than to tar.
  //
  // Measured against the reference, which is that kind of road. It holds 29.7%
  // of its pixels in two luminance bins at 144-159, one large uniform stretch
  // of mid-grey carriageway. Ours rendered into 48-95 and put only 2.6% in the
  // reference's peak, and since the road is the largest single area in frame
  // that one fact was most of a histogram distance of 1.09 against a 0.55
  // bound. Lightening the sky instead would have been chasing the smaller half.
  // Landed by measurement, not by eye. Texture luminance 63 rendered the road
  // into bins 48-95; 130 sent it past the reference's peak into 168-183, which
  // is a different wrong answer at the same distance. The response is close to
  // 1.5 rendered units per unit of texture luminance, so 115 puts the road in
  // 144-159 where the reference keeps 29.7% of its pixels.
  ctx.fillStyle = '#6e7382';
  ctx.fillRect(0, 0, W, H);

  // Aggregate speckle, and two darker wheel tracks per lane.
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 26;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);

  // A hint of darkening under the wheel tracks. Most of that effect now lives
  // in the roughness map beside this one, where it belongs.
  const laneW = W / laneCount;
  ctx.fillStyle = 'rgba(0,0,0,0.06)';
  for (let l = 0; l < laneCount; l++) {
    const cx = (l + 0.5) * laneW;
    ctx.fillRect(cx - laneW * 0.3, 0, laneW * 0.16, H);
    ctx.fillRect(cx + laneW * 0.14, 0, laneW * 0.16, H);
  }

  // Dashed lane dividers.
  ctx.fillStyle = '#d9dbe0';
  const dash = H / 6;
  for (let l = 1; l < laneCount; l++) {
    const x = l * laneW - 2.5;
    for (let y = 0; y < H; y += dash) ctx.fillRect(x, y, 5, dash * 0.52);
  }

  // Solid edge lines.
  ctx.fillStyle = '#e8e8ec';
  ctx.fillRect(3, 0, 6, H);
  ctx.fillRect(W - 9, 0, 6, H);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, repeatY);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * The roughness map that goes with the asphalt: where the road is polished.
 *
 * Read as a roughness channel, so dark is smooth. Two bands per lane are worn
 * glassy by tyres, the crown between them stays coarse, patches of newer
 * repair sit smoother than what surrounds them, and the painted markings are
 * smoother again. None of this is visible as colour — it only shows when there
 * is a light source to catch, which is exactly when a road should stop looking
 * like a grey ribbon.
 */
export function makeRoadWearTexture(laneCount: number, repeatY: number): THREE.Texture {
  const W = 256;
  const H = 256;
  const [c, ctx] = canvas(W, H);

  // Base: coarse, with per-pixel grain so the whole surface is never uniform.
  ctx.fillStyle = '#d2d2d2';
  ctx.fillRect(0, 0, W, H);
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 46;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);

  // Repair patches: laid before the wheel tracks, because a patch gets driven
  // on too and the tracks should run straight over the top of it.
  for (let i = 0; i < 5; i++) {
    const w = 26 + Math.random() * 70;
    const h = 30 + Math.random() * 90;
    ctx.fillStyle = `rgba(120,120,120,${0.3 + Math.random() * 0.35})`;
    ctx.fillRect(Math.random() * (W - w), Math.random() * (H - h), w, h);
  }

  // Two polished bands per lane, soft-edged.
  const laneW = W / laneCount;
  for (let l = 0; l < laneCount; l++) {
    const cx = (l + 0.5) * laneW;
    for (const offset of [-laneW * 0.22, laneW * 0.22]) {
      const g = ctx.createLinearGradient(cx + offset - laneW * 0.17, 0, cx + offset + laneW * 0.17, 0);
      g.addColorStop(0, 'rgba(90,90,90,0)');
      g.addColorStop(0.5, 'rgba(70,70,70,0.85)');
      g.addColorStop(1, 'rgba(90,90,90,0)');
      ctx.fillStyle = g;
      ctx.fillRect(cx + offset - laneW * 0.17, 0, laneW * 0.34, H);
    }
  }

  // Paint is smoother than the aggregate under it.
  ctx.fillStyle = '#4c4c4c';
  const dash = H / 6;
  for (let l = 1; l < laneCount; l++) {
    const x = l * laneW - 1.5;
    for (let y = 0; y < H; y += dash) ctx.fillRect(x, y, 3, dash * 0.52);
  }
  ctx.fillRect(1, 0, 3, H);
  ctx.fillRect(W - 4, 0, 3, H);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, repeatY);
  tex.anisotropy = 8;
  // A roughness map is data, not colour: converting it through sRGB would
  // silently change every value in it.
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

/** Rumble strip for the shoulders — alternating red/white blocks. */
export function makeShoulderTexture(): THREE.Texture {
  const [c, ctx] = canvas(32, 128);
  ctx.fillStyle = '#3a3d44';
  ctx.fillRect(0, 0, 32, 128);
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 ? '#c8c8cc' : '#b0303a';
    ctx.fillRect(0, i * 16, 32, 16);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 8);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * The ground either side of the road: dirt, grit and dry patches.
 *
 * Greyscale, and multiplied by whatever colour the biome sets, so one texture
 * serves sand, scrub and city dirt without three variants. What it is really
 * for is scale: a four-hundred-unit plane of flat colour has nothing on it for
 * the eye to measure speed against, so the verge sat still while the road
 * rushed past — the props standing on it were the only thing that moved.
 */
export function makeGroundTexture(): THREE.Texture {
  const S = 256;
  const [c, ctx] = canvas(S, S);

  ctx.fillStyle = '#b0b0b0';
  ctx.fillRect(0, 0, S, S);

  // Broad tonal drift, so the plane is not uniform at any scale.
  for (let i = 0; i < 26; i++) {
    const r = 18 + Math.random() * 62;
    const g = ctx.createRadialGradient(
      Math.random() * S, Math.random() * S, 0,
      Math.random() * S, Math.random() * S, r,
    );
    const shade = Math.random() < 0.5 ? 150 : 210;
    g.addColorStop(0, `rgba(${shade},${shade},${shade},0.22)`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  }

  // Grit.
  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 40;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(38, 5);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Soft radial sprite used for every particle and light bloom in the game. */
export function makeGlowTexture(): THREE.Texture {
  const [c, ctx] = canvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.7)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * A soft, lumpy puff for smoke and dust.
 *
 * Deliberately not the glow sprite. That one is a clean radial gradient, which
 * is right for a spark or a lamp and wrong for smoke — a hundred identical
 * circles fading out together read as a fog machine. Breaking the falloff up
 * with a few offset blobs gives each puff an edge that is not a perfect circle,
 * and that is most of what makes a cloud of them look like one cloud rather
 * than like a hundred sprites.
 */
export function makeSmokeTexture(): THREE.Texture {
  const S = 128;
  const [c, ctx] = canvas(S, S);
  const blob = (cx: number, cy: number, r: number, a: number): void => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(0.55, `rgba(255,255,255,${a * 0.45})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  };
  blob(64, 64, 60, 0.55);
  blob(48, 54, 34, 0.35);
  blob(80, 72, 30, 0.32);
  blob(70, 46, 24, 0.28);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * The soft dark patch a car casts straight down onto the road.
 *
 * A shadow map alone does not do this job. Its blur is uniform, so the darkest
 * part of a car's shadow is no darker directly under the sills than it is a
 * metre out, and the car reads as sitting *on* the road rather than in contact
 * with it. This is the ambient half of the same effect: an elliptical gradient,
 * dense under the body and gone by the edge, drawn under every car regardless
 * of tier — which is also what keeps the low tier, where shadows are off
 * entirely, from floating its cars over the tarmac.
 *
 * Authored as alpha over black. Multiply blending would be more physical, but
 * it also multiplies the road's specular back to nothing; painting black with
 * a falloff keeps the wet sheen on the tarmac around the car.
 */
export function makeContactShadowTexture(): THREE.Texture {
  const S = 128;
  const [c, ctx] = canvas(S, S);
  const img = ctx.createImageData(S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // Squashed along the car's length so the core follows the body rather
      // than pooling in a circle under the middle of it.
      const nx = (x / (S - 1)) * 2 - 1;
      const ny = (y / (S - 1)) * 2 - 1;
      const r = Math.hypot(nx * 1.28, ny);
      // Flat, dense core out to half the radius, then a smoothstep to
       // nothing. Measured: at a 40% core the band under the car came out only
       // 8% darker than the road either side, which reads as a smudge rather
       // than as contact.
      const t = Math.min(1, Math.max(0, (r - 0.5) / 0.5));
      const a = 1 - t * t * (3 - 2 * t);
      const i = (y * S + x) * 4;
      d[i] = 0; d[i + 1] = 0; d[i + 2] = 0;
      d[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Lit windows for city buildings, with a scattering of dark units. */
export function makeBuildingTexture(): THREE.Texture {
  const [c, ctx] = canvas(128, 256);
  ctx.fillStyle = '#1b1e26';
  ctx.fillRect(0, 0, 128, 256);
  for (let y = 6; y < 250; y += 14) {
    for (let x = 6; x < 122; x += 14) {
      const r = Math.random();
      ctx.fillStyle = r > 0.62 ? '#ffdd99' : r > 0.5 ? '#88aadd' : '#141720';
      ctx.fillRect(x, y, 9, 9);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

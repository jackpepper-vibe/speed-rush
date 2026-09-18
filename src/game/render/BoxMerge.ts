import * as THREE from 'three';

/**
 * Concatenate box geometries into one indexed buffer.
 *
 * Hand-rolled rather than pulled from `BufferGeometryUtils`: every caller here
 * is assembling a handful of boxes that share an attribute set exactly, and the
 * addon brings a general merge with morph-target, group and interleaved-buffer
 * handling that none of them need. Restricted to boxes on purpose — the
 * assumption that all parts carry position, normal and uv and nothing else is
 * what keeps this twenty lines instead of two hundred, and a caller that breaks
 * it should reach for the addon rather than grow this.
 *
 * The parts are not disposed; the caller owns them, because a caller that built
 * them from a cache would not want them released.
 */
export function mergeBoxes(
  parts: readonly THREE.BufferGeometry[],
  /**
   * One colour per part, baked into a `color` attribute.
   *
   * Optional, and absent by default, because most silhouettes assembled here
   * are a single material tinted per instance and an unused attribute is three
   * floats per vertex of dead bandwidth. It exists for the shapes whose
   * *internal* contrast is the thing that makes them legible: a liner two
   * hundred units out in haze is a white slab unless the hull under its decks
   * is dark, and one flat colour per instance cannot say that.
   *
   * A material that opts in with `vertexColors` multiplies this by its own
   * colour and by `instanceColor`, so a field can still tint the whole hull
   * per instance on top of the two-tone.
   */
  colours?: readonly THREE.Color[],
): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  const names = ['position', 'normal', 'uv'] as const;

  let vertexCount = 0;
  let indexCount = 0;
  for (const p of parts) {
    vertexCount += p.getAttribute('position').count;
    indexCount += p.getIndex()!.count;
  }

  if (colours) {
    if (colours.length !== parts.length) {
      throw new Error(`mergeBoxes: ${parts.length} parts but ${colours.length} colours`);
    }
    const data = new Float32Array(vertexCount * 3);
    let at = 0;
    for (let i = 0; i < parts.length; i++) {
      const c = colours[i];
      const count = parts[i].getAttribute('position').count;
      for (let v = 0; v < count; v++) {
        data[at++] = c.r;
        data[at++] = c.g;
        data[at++] = c.b;
      }
    }
    out.setAttribute('color', new THREE.BufferAttribute(data, 3));
  }

  for (const name of names) {
    const size = parts[0].getAttribute(name).itemSize;
    const data = new Float32Array(vertexCount * size);
    let at = 0;
    for (const p of parts) {
      data.set(p.getAttribute(name).array as Float32Array, at);
      at += p.getAttribute(name).count * size;
    }
    out.setAttribute(name, new THREE.BufferAttribute(data, size));
  }

  const indices = new Uint16Array(indexCount);
  let vertexBase = 0;
  let at = 0;
  for (const p of parts) {
    const src = p.getIndex()!;
    for (let i = 0; i < src.count; i++) indices[at++] = src.getX(i) + vertexBase;
    vertexBase += p.getAttribute('position').count;
  }
  out.setIndex(new THREE.BufferAttribute(indices, 1));
  return out;
}

/**
 * A box placed by its extents rather than by its centre.
 *
 * Every silhouette assembled through `mergeBoxes` is authored in a unit cell so
 * that one instance matrix can carry both a footprint and a height, and in that
 * space it is the *top* of a wheelhouse or the *waterline* of a hull that is
 * known, not the middle. Doing the arithmetic at each call site is where the
 * half-widths go wrong.
 */
export function boxBetween(
  x0: number, x1: number, y0: number, y1: number, z0: number, z1: number,
): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  geo.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return geo;
}

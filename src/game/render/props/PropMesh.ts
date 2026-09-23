import * as THREE from 'three';

/**
 * A small accumulator for prop geometry: positions, normals, UVs and a colour
 * per vertex, with the part-level helpers every prop needs.
 *
 * Props are instanced — one geometry per kind, hundreds of copies — so what is
 * built here is built once and the per-vertex colour is the only variation a
 * single draw call can carry. It is used for tint and for baked occlusion: the
 * base of a trunk and the heart of a crown are darker because nothing lights
 * them, and a vertex colour is the cheapest place to say so.
 */
export class PropMesh {
  private readonly pos: number[] = [];
  private readonly nrm: number[] = [];
  private readonly uv: number[] = [];
  private readonly col: number[] = [];
  private readonly idx: number[] = [];

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  vertex(p: THREE.Vector3, n: THREE.Vector3, u: number, v: number, c: THREE.Color): number {
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(n.x, n.y, n.z);
    this.uv.push(u, v);
    this.col.push(c.r, c.g, c.b);
    return this.pos.length / 3 - 1;
  }

  triangle(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  /**
   * Append a three.js geometry through a transform, its UVs squeezed into
   * `uvRect` and every vertex coloured `colour`.
   */
  addGeometry(geo: THREE.BufferGeometry, matrix: THREE.Matrix4, uvRect: readonly [number, number, number, number], colour: THREE.Color): void {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
    const uv = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
    const nm = new THREE.Matrix3().getNormalMatrix(matrix);
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    const flip = matrix.determinant() < 0;
    const [u0, v0, u1, v1] = uvRect;
    const base = this.vertexCount;
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(matrix);
      n.fromBufferAttribute(nrm, i).applyMatrix3(nm).normalize();
      const u = uv ? u0 + (u1 - u0) * clamp01(uv.getX(i)) : (u0 + u1) / 2;
      const v = uv ? v0 + (v1 - v0) * clamp01(uv.getY(i)) : (v0 + v1) / 2;
      this.vertex(p, n, u, v, colour);
    }
    for (let i = 0; i < pos.count; i += 3) {
      if (flip) this.triangle(base + i, base + i + 2, base + i + 1);
      else this.triangle(base + i, base + i + 1, base + i + 2);
    }
    if (g !== geo) g.dispose();
  }

  toGeometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.vertexCount > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Deterministic generator for authoring variants. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Linear colour from an sRGB hex, for vertex colours. */
export function linear(hex: number): THREE.Color {
  return new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
}

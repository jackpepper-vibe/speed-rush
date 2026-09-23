import { ATLAS, type AtlasRect } from './VehicleAtlas';
import { LAMP_CHANNEL, type LampChannel } from './VehicleMaterial';

/**
 * What a piece of a vehicle is made of.
 *
 * A surface is per-vertex data rather than a material: the single vehicle
 * shader reads roughness, metalness, clearcoat, the paint mask and the lamp
 * channel off every vertex. So "chrome" or "glass" here is a set of numbers,
 * and a car made of twelve of them is still one draw call.
 */
export interface Surface {
  readonly name: string;
  /** Albedo as an sRGB hex. Ignored where `paint` is 1, except as a multiplier. */
  readonly color: number;
  readonly roughness: number;
  readonly metalness: number;
  readonly clearcoat: number;
  /** 1 takes the car's paint colour; 0 keeps `color`. */
  readonly paint: number;
  readonly lamp: LampChannel;
  /** Emissive level of a lamp surface when its channel is fully on. */
  readonly glow: number;
  /** Atlas region the geometry's own 0..1 UVs are mapped into. */
  readonly tex: AtlasRect;
}

export function surface(name: string, spec: Partial<Omit<Surface, 'name'>>): Surface {
  return {
    name,
    color: 0xffffff,
    roughness: 0.5,
    metalness: 0,
    clearcoat: 0,
    paint: 0,
    lamp: LAMP_CHANNEL.none,
    glow: 0,
    tex: ATLAS.white,
    ...spec,
  };
}

/** The same surface, drawing its pattern from a different atlas region. */
export function withTex(base: Surface, tex: AtlasRect, name = `${base.name}:tex`): Surface {
  return { ...base, name, tex };
}

export const SURF = {
  /*
   * Paint: a fairly rough base under a mirror-tight clearcoat. The coat is
   * what returns the sky as a distinct band along the shoulders; the base
   * roughness keeps the colour itself from turning into a reflection.
   */
  paint: surface('paint', { roughness: 0.34, metalness: 0.15, clearcoat: 1, paint: 1 }),
  paintMetallic: surface('paint-metallic', { roughness: 0.3, metalness: 0.55, clearcoat: 1, paint: 1 }),
  /** Painted, but without the lacquer — sills, pressed louvres. */
  paintSatin: surface('paint-satin', { roughness: 0.55, metalness: 0.1, clearcoat: 0.2, paint: 1 }),

  /*
   * Car glass seen from outside is a dark mirror, not a window. Opaque here,
   * which is what it looks like on a real car at any distance and what lets
   * it stay in the single draw call.
   */
  glass: surface('glass', { color: 0x0b1016, roughness: 0.04, metalness: 0.2, clearcoat: 1 }),
  glassTint: surface('glass-tint', { color: 0x10181c, roughness: 0.06, metalness: 0.15, clearcoat: 1 }),

  chrome: surface('chrome', { color: 0xe4e8ee, roughness: 0.07, metalness: 1 }),
  brushed: surface('brushed', { color: 0xb6bcc4, roughness: 0.3, metalness: 1 }),
  trimGloss: surface('trim-gloss', { color: 0x0b0c0f, roughness: 0.12, metalness: 0.1, clearcoat: 1 }),
  trimSatin: surface('trim-satin', { color: 0x141518, roughness: 0.55, metalness: 0.05 }),
  trimMatte: surface('trim-matte', { color: 0x0f1012, roughness: 0.82 }),
  /** The dark in wheel arches, under the sills, behind a grille. */
  cavity: surface('cavity', { color: 0x050506, roughness: 0.95 }),
  underbody: surface('underbody', { color: 0x0a0a0c, roughness: 0.9 }),
  rubber: surface('rubber', { color: 0x16171a, roughness: 0.78 }),
  seal: surface('seal', { color: 0x0a0b0d, roughness: 0.6 }),

  rimSilver: surface('rim-silver', { color: 0xc4cad2, roughness: 0.22, metalness: 1 }),
  rimDark: surface('rim-dark', { color: 0x2a2d33, roughness: 0.3, metalness: 0.9 }),
  rimGold: surface('rim-gold', { color: 0xc9a352, roughness: 0.25, metalness: 1 }),
  brakeDisc: surface('brake-disc', { color: 0x6a6e74, roughness: 0.45, metalness: 1 }),

  interior: surface('interior', { color: 0x1c1d20, roughness: 0.8 }),
  leather: surface('leather', { color: 0x9a6a4a, roughness: 0.62, tex: ATLAS.seat }),
  skin: surface('skin', { color: 0xc99478, roughness: 0.62 }),
  hair: surface('hair', { color: 0x3a2618, roughness: 0.7 }),
  shirt: surface('shirt', { color: 0xf2f2ee, roughness: 0.85 }),

  grille: surface('grille', { color: 0xffffff, roughness: 0.6, metalness: 0.3, tex: ATLAS.grille }),
  vents: surface('vents', { color: 0xffffff, roughness: 0.6, tex: ATLAS.vents }),
  carbon: surface('carbon', { color: 0xffffff, roughness: 0.25, clearcoat: 1, tex: ATLAS.carbon }),

  tailRound: surface('tail-round', { roughness: 0.18, clearcoat: 1, lamp: LAMP_CHANNEL.brake, glow: 0.9, tex: ATLAS.roundRed }),
  tailRoundDeep: surface('tail-round-deep', { roughness: 0.18, clearcoat: 1, lamp: LAMP_CHANNEL.tail, glow: 0.9, tex: ATLAS.roundRedDeep }),
  amberRound: surface('amber-round', { roughness: 0.18, clearcoat: 1, lamp: LAMP_CHANNEL.amber, glow: 0.7, tex: ATLAS.roundAmber }),
  tailCluster: surface('tail-cluster', { roughness: 0.18, clearcoat: 1, lamp: LAMP_CHANNEL.brake, glow: 0.8, tex: ATLAS.rectCluster }),
  tailBar: surface('tail-bar', { roughness: 0.15, clearcoat: 1, lamp: LAMP_CHANNEL.brake, glow: 1.4, tex: ATLAS.ledBar }),
  tailTriple: surface('tail-triple', { roughness: 0.18, clearcoat: 1, lamp: LAMP_CHANNEL.brake, glow: 0.9, tex: ATLAS.tripleBar }),
  tailLouvre: surface('tail-louvre', { roughness: 0.25, clearcoat: 1, lamp: LAMP_CHANNEL.brake, glow: 0.8, tex: ATLAS.louvreLamp }),
  tailY: surface('tail-y', { roughness: 0.12, clearcoat: 1, lamp: LAMP_CHANNEL.brake, glow: 1.6, tex: ATLAS.yLamp }),
  tailSlim: surface('tail-slim', { roughness: 0.12, clearcoat: 1, lamp: LAMP_CHANNEL.brake, glow: 1.5, tex: ATLAS.slimLamp }),

  headRound: surface('head-round', { roughness: 0.1, clearcoat: 1, lamp: LAMP_CHANNEL.head, glow: 2.2, tex: ATLAS.roundHead }),
  headRoundSmall: surface('head-round-small', { roughness: 0.1, clearcoat: 1, lamp: LAMP_CHANNEL.head, glow: 2.2, tex: ATLAS.roundHeadSmall }),
  headModern: surface('head-modern', { roughness: 0.1, clearcoat: 1, lamp: LAMP_CHANNEL.head, glow: 2.2, tex: ATLAS.headModern }),
  headSquare: surface('head-square', { roughness: 0.1, clearcoat: 1, lamp: LAMP_CHANNEL.head, glow: 2, tex: ATLAS.headSquare }),
  amberMarker: surface('amber-marker', { color: 0xff9a2a, roughness: 0.2, clearcoat: 1, lamp: LAMP_CHANNEL.amber, glow: 0.6 }),
  redMarker: surface('red-marker', { color: 0xff2a1a, roughness: 0.2, clearcoat: 1, lamp: LAMP_CHANNEL.tail, glow: 0.9 }),
  reverse: surface('reverse', { color: 0xe8ecf0, roughness: 0.15, clearcoat: 1 }),

  plate: (index: number): Surface =>
    surface(`plate-${index}`, { roughness: 0.4, lamp: LAMP_CHANNEL.constant, glow: 0.12, tex: ATLAS.plates[index % ATLAS.plates.length] }),
  bikePlate: surface('plate-bike', { roughness: 0.4, lamp: LAMP_CHANNEL.constant, glow: 0.12, tex: ATLAS.bikePlate }),
} as const;

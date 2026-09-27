/**
 * The leaderboard contract, shared by the game and the `/api/scores` function.
 *
 * One module so the two sides cannot drift: the name the game shows while a
 * submission is in flight is the name the server will store, and a score the
 * game would submit is a score the server will accept.
 *
 * Pure: no DOM and no Node APIs, so it compiles into both the browser bundle
 * and the serverless function unchanged.
 */

/** Longest driver name the board has room for. */
export const NAME_MAX = 12;

/** Rows the board holds. */
export const BOARD_SIZE = 10;

/**
 * The global season. Raising it starts every player on an empty board; old
 * rows stay in the table under their season and simply stop being read.
 */
export const LEADERBOARD_SEASON = 1;

/** One row of the board: one run this season. A driver may hold several. */
export interface BoardEntry {
  name: string;
  score: number;
  distance: number;
}

/** What `GET` and `POST /api/scores` answer with. */
export interface BoardResponse {
  ok: boolean;
  season: number;
  board: BoardEntry[];
  /** POST only: 1-based position of the run just submitted among all this season's runs. */
  rank?: number;
  /** POST only: whether this run beat everything the driver had posted this season. */
  improved?: boolean;
  error?: string;
}

/** What the game posts at the end of a run. */
export interface Submission {
  name: string;
  score: number;
  distance: number;
}

/**
 * A driver name as the board stores it: no control characters, runs of
 * whitespace collapsed, trimmed, cut to what the board has room for, and in
 * capitals, the way an arcade board and the name field both show it.
 */
export function cleanName(raw: unknown): string {
  return String(raw ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX)
    .toUpperCase();
}

/**
 * Scoring rates the plausibility bound is built from. Kept generous on purpose:
 * the bound exists to keep obvious nonsense off a public board, and a real run
 * that trips it would be a far worse bug than a cheat that slips under it.
 *
 * Distance pays 0.34 a metre; a near miss pays at most 209 at a full combo; a
 * gem 90. Twelve a metre covers a run that does nothing but thread traffic.
 */
const MAX_POINTS_PER_METRE = 12;
const MILESTONE_BONUS = 250;
const SLACK = 2_000;
/** A run longer than this is not something the game can produce in one sitting. */
const MAX_DISTANCE = 500_000;

/** Highest score a run of `distance` metres could plausibly reach. */
export function scoreCeiling(distance: number): number {
  const km = Math.floor(distance / 1000);
  // Milestones pay 250 x tier at each kilometre: 250 x (1 + 2 + ... + km).
  return SLACK + distance * MAX_POINTS_PER_METRE + (MILESTONE_BONUS * km * (km + 1)) / 2;
}

export type Validation = { entry: Submission; error?: never } | { entry?: never; error: string };

/**
 * Validate a submission from an untrusted client.
 *
 * The client is a web page, so a determined person can post whatever they
 * like. These bounds keep casual tampering off the board; they are not
 * security, and nothing depends on them being so.
 */
export function validateSubmission(body: unknown): Validation {
  const raw = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const name = cleanName(raw.name);
  if (!name) return { error: 'a driver name is required' };

  const score = Math.floor(Number(raw.score));
  if (!Number.isFinite(score) || score <= 0) return { error: 'score must be a positive number' };

  const distance = Math.floor(Number(raw.distance));
  if (!Number.isFinite(distance) || distance < 0 || distance > MAX_DISTANCE) {
    return { error: 'distance is not plausible' };
  }
  if (score > scoreCeiling(distance)) return { error: 'score does not match the distance driven' };

  return { entry: { name, score, distance } };
}

/** Parse a board from an untrusted source (the network, or a cached copy). */
export function parseBoard(data: unknown): BoardEntry[] {
  if (!Array.isArray(data)) return [];
  const rows: BoardEntry[] = [];
  for (const row of data) {
    if (typeof row !== 'object' || row === null) continue;
    const r = row as Record<string, unknown>;
    const name = cleanName(r.name);
    const score = Math.floor(Number(r.score));
    const distance = Math.floor(Number(r.distance));
    if (!name || !Number.isFinite(score) || score <= 0) continue;
    rows.push({ name, score, distance: Number.isFinite(distance) && distance > 0 ? distance : 0 });
  }
  return rows.sort((a, b) => b.score - a.score).slice(0, BOARD_SIZE);
}

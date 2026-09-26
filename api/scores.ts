/**
 * The global leaderboard for Speed Rush.
 *
 *   GET  /api/scores   this season's top drivers, best run each
 *   POST /api/scores   submit a run: { name, score, distance }
 *
 * Backed by the account's shared Neon Postgres store, in tables of its own
 * (prefixed `speed_rush_`, since other games live in the same database). One
 * row per driver per season, keyed on the cleaned name and overwritten only by
 * a better run, so the board shows ten drivers rather than one good session
 * ten times.
 *
 * If the store is not configured the endpoint says so plainly with a 503 and
 * the game shows its cached board. The leaderboard never blocks play.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import {
  BOARD_SIZE,
  LEADERBOARD_SEASON,
  type BoardEntry,
  type BoardResponse,
  validateSubmission,
} from '../shared/leaderboard.js';

/** The request and response helpers Vercel's Node runtime adds. */
interface ApiRequest extends IncomingMessage {
  body?: unknown;
}
interface ApiResponse extends ServerResponse {
  status(code: number): ApiResponse;
  json(body: unknown): void;
}

type Sql = NeonQueryFunction<false, false>;

/** Submissions one address may make in a minute. A run takes longer than that. */
const RATE_PER_MINUTE = 10;

function connectionString(): string | undefined {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL;
}

/**
 * Connect and make sure the tables exist, once per cold start.
 *
 * Creating them here rather than in a migration keeps the deploy one step, and
 * a failure clears the cached promise so the next request retries instead of
 * inheriting a rejected connection for the life of the instance.
 */
let ready: Promise<Sql> | null = null;
function database(url: string): Promise<Sql> {
  ready ??= (async () => {
    const sql = neon(url);
    await sql`
      CREATE TABLE IF NOT EXISTS speed_rush_scores (
        season     integer     NOT NULL,
        name       text        NOT NULL,
        score      integer     NOT NULL,
        distance   integer     NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (season, name)
      )`;
    await sql`
      CREATE INDEX IF NOT EXISTS speed_rush_scores_rank
      ON speed_rush_scores (season, score DESC)`;
    await sql`
      CREATE TABLE IF NOT EXISTS speed_rush_rate (
        ip    text        PRIMARY KEY,
        n     integer     NOT NULL,
        since timestamptz NOT NULL DEFAULT now()
      )`;
    return sql;
  })().catch((err: unknown) => {
    ready = null;
    throw err;
  });
  return ready;
}

async function board(sql: Sql): Promise<BoardEntry[]> {
  const rows = await sql`
    SELECT name, score, distance
    FROM speed_rush_scores
    WHERE season = ${LEADERBOARD_SEASON}
    ORDER BY score DESC, updated_at ASC
    LIMIT ${BOARD_SIZE}`;
  return rows.map((r) => ({ name: String(r.name), score: Number(r.score), distance: Number(r.distance) }));
}

/** A fixed one-minute window per address. Crude, and enough for a game. */
async function throttled(sql: Sql, req: ApiRequest): Promise<boolean> {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded ?? '').split(',')[0].trim() || 'unknown';
  const rows = await sql`
    INSERT INTO speed_rush_rate (ip, n) VALUES (${ip}, 1)
    ON CONFLICT (ip) DO UPDATE SET
      n     = CASE WHEN speed_rush_rate.since < now() - interval '1 minute' THEN 1
                   ELSE speed_rush_rate.n + 1 END,
      since = CASE WHEN speed_rush_rate.since < now() - interval '1 minute' THEN now()
                   ELSE speed_rush_rate.since END
    RETURNING n`;
  return Number(rows[0]?.n ?? 0) > RATE_PER_MINUTE;
}

/**
 * The request body, or null if it is not JSON. Vercel parses `req.body` lazily
 * and its getter throws on a malformed JSON body, which must be a 400, not a 500.
 */
function readBody(req: ApiRequest): unknown {
  try {
    const body = req.body;
    return typeof body === 'string' ? JSON.parse(body) : body;
  } catch {
    return null;
  }
}

function reply(res: ApiResponse, code: number, body: Omit<BoardResponse, 'season'>): void {
  res.status(code).json({ season: LEADERBOARD_SEASON, ...body } satisfies BoardResponse);
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');

  const url = connectionString();
  if (!url) {
    reply(res, 503, { ok: false, board: [], error: 'leaderboard store is not configured' });
    return;
  }

  try {
    const sql = await database(url);

    if (req.method === 'GET') {
      reply(res, 200, { ok: true, board: await board(sql) });
      return;
    }

    if (req.method === 'POST') {
      const result = validateSubmission(readBody(req));
      if (result.error !== undefined) {
        reply(res, 400, { ok: false, board: [], error: result.error });
        return;
      }
      if (await throttled(sql, req)) {
        reply(res, 429, { ok: false, board: [], error: 'too many submissions' });
        return;
      }

      const { name, score, distance } = result.entry;
      // One row per driver, replaced only by a better run.
      const improved = await sql`
        INSERT INTO speed_rush_scores (season, name, score, distance)
        VALUES (${LEADERBOARD_SEASON}, ${name}, ${score}, ${distance})
        ON CONFLICT (season, name) DO UPDATE SET
          score = EXCLUDED.score, distance = EXCLUDED.distance, updated_at = now()
        WHERE speed_rush_scores.score < EXCLUDED.score
        RETURNING name`;
      const ahead = await sql`
        SELECT count(*)::int AS n FROM speed_rush_scores
        WHERE season = ${LEADERBOARD_SEASON}
          AND score > (SELECT score FROM speed_rush_scores
                       WHERE season = ${LEADERBOARD_SEASON} AND name = ${name})`;

      reply(res, 200, {
        ok: true,
        improved: improved.length > 0,
        rank: Number(ahead[0]?.n ?? 0) + 1,
        board: await board(sql),
      });
      return;
    }

    res.setHeader('Allow', 'GET, POST');
    reply(res, 405, { ok: false, board: [], error: 'method not allowed' });
  } catch (err) {
    console.error('[scores]', err);
    reply(res, 500, { ok: false, board: [], error: 'leaderboard unavailable' });
  }
}

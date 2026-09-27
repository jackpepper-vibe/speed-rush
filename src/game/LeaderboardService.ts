import type { EventBus } from '@/core/EventBus';
import type { GameEvents, LeaderboardStatus } from '@/core/GameEvents';
import {
  BOARD_SIZE,
  LEADERBOARD_SEASON,
  type BoardEntry,
  type BoardResponse,
  type Submission,
  cleanName,
  parseBoard,
  validateSubmission,
} from '@shared/leaderboard';

const CACHE_KEY = 'speedrush.board.v1';
/** Runs kept for retry while the server cannot be reached. */
const PENDING_MAX = 10;
/** A request slower than this is treated as a failure, not waited on. */
const REQUEST_TIMEOUT_MS = 8_000;
/** How stale the board may get before returning to the menu fetches it again. */
const REFRESH_AFTER_MS = 20_000;

interface Cache {
  season: number;
  board: BoardEntry[];
  pending: Submission[];
}

/** What a request to the server came back as. */
type Outcome =
  | { kind: 'ok'; body: BoardResponse }
  /** The server understood and refused: retrying the same request will not help. */
  | { kind: 'rejected' }
  /** No usable answer — offline, timed out, server error. Worth retrying later. */
  | { kind: 'unreachable' };

/**
 * The global leaderboard, as the game sees it.
 *
 * The server's board is the only authority. Everything kept locally exists so
 * the board degrades rather than disappears:
 *
 *  - the last board the server gave is cached and shown until a fresh one
 *    arrives, so the menu never opens on an empty table while a request is out;
 *  - a finished run goes onto the board on screen at once, and is replaced by
 *    the server's answer when it lands;
 *  - a run that could not be sent is queued and sent the next time the board
 *    is fetched, so a dropped connection at the end of a good run does not
 *    lose it.
 *
 * Every change is announced on the bus as `leaderboard:update`; nothing reads
 * this class on a timer.
 */
export class LeaderboardService {
  private board: BoardEntry[] = [];
  private pending: Submission[] = [];
  private state: LeaderboardStatus = 'loading';
  private fetchedAt = 0;
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly bus: EventBus<GameEvents>,
    private readonly endpoint = '/api/scores',
    private readonly storage: Storage | null = safeStorage(),
  ) {
    const cache = this.readCache();
    this.board = cache.board;
    this.pending = cache.pending;
  }

  /** The board on hand, best first. */
  get rows(): readonly BoardEntry[] {
    return this.board;
  }

  get status(): LeaderboardStatus {
    return this.state;
  }

  /**
   * Fetch the board, sending any queued runs first.
   *
   * Calls made while one is already out share it. Unless `force` is set, a
   * board fetched within the last few seconds is kept rather than asked for
   * again, so flicking between screens does not hammer the server.
   */
  refresh(force = false): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if (!force && this.state === 'live' && performance.now() - this.fetchedAt < REFRESH_AFTER_MS) {
      return Promise.resolve();
    }
    this.inFlight = this.sync().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /**
   * Submit a finished run.
   *
   * It is on the board on screen before this returns; the promise settles once
   * the server has answered or the run has been queued for later.
   */
  async submit(run: Submission): Promise<void> {
    const checked = validateSubmission(run);
    if (checked.error !== undefined) return;
    const entry = checked.entry;

    this.board = placeOnBoard(this.board, entry);
    this.announce();

    // Let an in-progress fetch finish first so its answer cannot land after
    // this one and put the board back to how it was before the run.
    await this.inFlight;
    const outcome = await this.post(entry);
    if (outcome.kind === 'unreachable') {
      this.enqueue(entry);
      this.setOffline();
      this.bus.emit('leaderboard:submitted', { outcome: 'queued', rank: null, improved: false });
      return;
    }
    if (outcome.kind === 'rejected') {
      // Off the server, so off the screen: fetch the board as it really is.
      this.bus.emit('leaderboard:submitted', { outcome: 'rejected', rank: null, improved: false });
      await this.refresh(true);
      return;
    }
    this.accept(outcome.body);
    this.bus.emit('leaderboard:submitted', {
      outcome: 'placed',
      rank: outcome.body.rank ?? null,
      improved: outcome.body.improved === true,
    });
  }

  /** Forget the cached board and queue. The test seam `resetSave` goes through here. */
  clear(): void {
    this.board = [];
    this.pending = [];
    this.fetchedAt = 0;
    this.state = 'loading';
    this.writeCache();
    this.announce();
  }

  /* ------------------------------------------------------------- internals */

  private async sync(): Promise<void> {
    // Oldest first, so the queue drains in the order the runs were driven.
    while (this.pending.length > 0) {
      const outcome = await this.post(this.pending[0]);
      if (outcome.kind === 'unreachable') {
        this.setOffline();
        return;
      }
      this.pending.shift();
      this.writeCache();
      if (outcome.kind === 'ok') this.accept(outcome.body);
    }

    const outcome = await this.request({ method: 'GET' });
    if (outcome.kind === 'ok') this.accept(outcome.body);
    else this.setOffline();
  }

  private post(entry: Submission): Promise<Outcome> {
    return this.request({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    });
  }

  private async request(init: RequestInit): Promise<Outcome> {
    try {
      const res = await fetch(this.endpoint, {
        ...init,
        cache: 'no-store',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      // A 4xx other than rate limiting is a refusal of this request. 429 and
      // 5xx (including 503, store not configured) are the server's problem and
      // may clear up, so those runs are kept for another try.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) return { kind: 'rejected' };
      if (!res.ok) return { kind: 'unreachable' };
      // A static host with no functions answers with the app's HTML page.
      if (!res.headers.get('content-type')?.includes('application/json')) return { kind: 'unreachable' };
      const body = (await res.json()) as Partial<BoardResponse>;
      if (body.ok !== true) return { kind: 'unreachable' };
      return {
        kind: 'ok',
        body: {
          ok: true,
          season: Number(body.season),
          board: parseBoard(body.board),
          rank: typeof body.rank === 'number' ? body.rank : undefined,
          improved: body.improved === true,
        },
      };
    } catch {
      return { kind: 'unreachable' };
    }
  }

  /** Take the server's board as the truth. */
  private accept(body: BoardResponse): void {
    this.board = body.board;
    // Queued runs are not on the server's board yet, but they are the
    // player's, and a board without them would look as if they were lost.
    for (const run of this.pending) this.board = placeOnBoard(this.board, run);
    this.state = this.pending.length > 0 ? 'offline' : 'live';
    this.fetchedAt = performance.now();
    this.writeCache();
    this.announce();
  }

  private setOffline(): void {
    this.state = 'offline';
    this.writeCache();
    this.announce();
  }

  private enqueue(entry: Submission): void {
    this.pending.push(entry);
    if (this.pending.length > PENDING_MAX) this.pending.splice(0, this.pending.length - PENDING_MAX);
    this.writeCache();
  }

  private announce(): void {
    this.bus.emit('leaderboard:update', { status: this.state, rows: this.board.length });
  }

  private readCache(): Cache {
    const empty: Cache = { season: LEADERBOARD_SEASON, board: [], pending: [] };
    if (!this.storage) return empty;
    try {
      const raw = this.storage.getItem(CACHE_KEY);
      if (!raw) return empty;
      const parsed = JSON.parse(raw) as Partial<Cache>;
      // A board from another season is not this season's board, and a run
      // queued in it belongs to a contest that has closed.
      if (parsed.season !== LEADERBOARD_SEASON) return empty;
      const pending = Array.isArray(parsed.pending)
        ? parsed.pending.flatMap((p) => validateSubmission(p).entry ?? []).slice(-PENDING_MAX)
        : [];
      return { season: LEADERBOARD_SEASON, board: parseBoard(parsed.board), pending };
    } catch {
      return empty;
    }
  }

  private writeCache(): void {
    if (!this.storage) return;
    const cache: Cache = { season: LEADERBOARD_SEASON, board: this.board, pending: this.pending };
    try {
      this.storage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch {
      // Quota or private mode: the board still works, it just is not remembered.
    }
  }
}

/**
 * Put a run on a board the way the server would: every run is its own row, so
 * a driver can hold several places; the board is the best ten of them, an
 * earlier run keeping its place over a later one on the same score.
 */
function placeOnBoard(board: readonly BoardEntry[], run: Submission): BoardEntry[] {
  const entry = { name: cleanName(run.name), score: run.score, distance: run.distance };
  const at = board.findIndex((r) => r.score < entry.score);
  const next = [...board];
  next.splice(at < 0 ? next.length : at, 0, entry);
  return next.slice(0, BOARD_SIZE);
}

function safeStorage(): Storage | null {
  try {
    const s = window.localStorage;
    s.getItem(CACHE_KEY);
    return s;
  } catch {
    return null;
  }
}

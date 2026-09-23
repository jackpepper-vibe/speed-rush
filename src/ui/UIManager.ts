import type { Manager } from '@/core/Manager';
import { isTyping } from '@/core/dom';
import { NAME_MAX } from '@/game/SaveManager';
import type { PowerupId, RunState } from '@/core/GameEvents';
import { SPEED } from '@/game/config/Balance';
import { POWERUP_INFO, powerupCss } from '@/game/config/Powerups';
import { UPGRADE, type UpgradableStat } from '@/game/config/Cars';
import type { Game } from '@/game/Game';
import { previewFor, renderCarPreviews } from './CarPreview';
import { powerupIcon } from './PowerupIcons';

/**
 * The interface: HUD, menu, garage, pause and results.
 *
 * Built from DOM rather than drawn into the canvas. Text stays crisp at any
 * device pixel ratio, it respects the reader's font size, and the buttons are
 * real buttons that a keyboard and a screen reader already understand — none of
 * which comes free when you paint controls into a WebGL context.
 *
 * Nothing here computes game state. Every number is read from the game and
 * formatted, which is what lets the probe assert that what is on screen matches
 * what the simulation believes: a speedometer that drifts from the actual speed
 * is a bug a screenshot will happily show as a perfectly plausible number.
 */

/** Elements that must exist and must carry live values. The HUD coverage gate. */
export const HUD_ELEMENTS = [
  'hud-score', 'hud-distance', 'hud-speed', 'hud-gear',
  'hud-coin-count', 'hud-combo-mult', 'hud-combo-chain', 'hud-combo-bar',
  'hud-powerups', 'hud-countdown',
] as const;

/** Screens that must exist. */
export const SCREEN_ELEMENTS = [
  'screen-menu', 'screen-garage', 'screen-pause', 'screen-gameover', 'screen-leaderboard',
] as const;

/** Seconds left at which a power-up card starts to flash. */
const ENDING_SECONDS = 2;
/** Circumference of the countdown ring on a power-up card (r = 19). */
const RING = 2 * Math.PI * 19;

const STAT_ORDER: UpgradableStat[] = ['topSpeed', 'accel', 'grip', 'boost'];
const STAT_LABEL: Record<UpgradableStat, string> = {
  topSpeed: 'Top speed', accel: 'Accel', grip: 'Grip', boost: 'Boost',
};

/** DOM writes are throttled to this; the simulation runs at 120Hz. */
const HUD_HZ = 20;

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`UI element #${id} missing from the document`);
  return node as T;
}

function metres(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(2)} km` : `${Math.round(n)} m`;
}

export class UIManager implements Manager {
  readonly name = 'ui';

  private readonly hud = el('hud');
  private readonly countdown = el('hud-countdown');
  private readonly combo = el('hud-combo');
  private readonly comboBar = el('hud-combo-bar');
  private readonly powerupRow = el('hud-powerups');
  private readonly flash = el('hud-flash');
  private readonly announcer = el('hud-announce');
  private readonly veil = el('hud-veil');
  /** Set when a shield is spent on a crash, so its expiry is not announced over the save. */
  private shieldSpent = false;

  private lastState: RunState | null = null;
  private accumulator = 0;
  /** Text already written, so an unchanged value is not re-assigned. */
  private readonly written = new Map<string, string>();
  private garageDirty = true;

  constructor(private readonly game: Game) {}

  init(): void {
    this.wireButtons();
    this.wireKeys();
    this.wireCues();
    this.showFor(this.game.runState);
  }

  /* ---------------------------------------------------------------- wiring */

  /** Write text only when it has changed — this runs 20 times a second. */
  private text(id: string, value: string): void {
    if (this.written.get(id) === value) return;
    this.written.set(id, value);
    el(id).textContent = value;
  }

  private wireButtons(): void {
    // Any click is a user gesture, which is the only moment a browser will let
    // an AudioContext start. Cheaper to do it here than to track "has the user
    // interacted yet" separately.
    document.addEventListener('pointerdown', () => this.game.audio.resume(), { once: true });

    el('btn-drive').addEventListener('click', () => this.requestDrive());
    el('btn-garage').addEventListener('click', () => {
      this.garageDirty = true;
      this.game.toGarage();
    });
    el('btn-garage-back').addEventListener('click', () => this.game.toMenu());
    el('btn-garage-drive').addEventListener('click', () => this.requestDrive());
    el('btn-resume').addEventListener('click', () => this.game.unpause());
    el('btn-quit').addEventListener('click', () => this.game.toMenu());
    el('btn-again').addEventListener('click', () => this.requestDrive());

    el('btn-menu').addEventListener('click', () => this.game.toMenu());

    this.wireDriverName();

    const mute = el<HTMLButtonElement>('btn-mute');
    const paint = (): void => {
      const muted = this.game.audio.isMuted;
      mute.textContent = `Sound: ${muted ? 'off' : 'on'}`;
      mute.setAttribute('aria-pressed', String(muted));
    };
    mute.addEventListener('click', () => {
      this.game.audio.resume();
      this.game.audio.toggleMute();
      paint();
    });
    paint();
  }

  /**
   * The driver's name, for the leaderboard.
   *
   * Saved as it is typed, so a name entered and then left by way of the garage
   * is not lost. Enter in the field is the same as pressing Drive.
   */
  private wireDriverName(): void {
    const input = el<HTMLInputElement>('driver-name');
    input.maxLength = NAME_MAX;
    input.value = this.game.save.snapshot.playerName;
    input.addEventListener('input', () => {
      this.game.save.setName(input.value);
      if (this.game.save.snapshot.playerName) this.setNameWanted(false);
    });
    // Tidy what is shown to what was stored once the player is done with it.
    input.addEventListener('blur', () => {
      input.value = this.game.save.snapshot.playerName;
    });
    el<HTMLFormElement>('driver-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.requestDrive();
    });
  }

  /**
   * Start a run — once there is a name to put on the leaderboard.
   *
   * Without one, the player is taken to the field rather than into the race:
   * a run that ends on the board as "YOU" is a result that cannot be told
   * apart from anyone else's on the same machine.
   */
  private requestDrive(): void {
    if (this.game.save.snapshot.playerName) {
      this.setNameWanted(false);
      this.game.startCountdown(3);
      return;
    }
    this.setNameWanted(true);
    if (this.game.runState === 'menu') this.focusName();
    else {
      this.focusNameOnMenu = true;
      this.game.toMenu();
    }
  }

  /** Set when leaving another screen to ask for a name, which can only take focus once the menu is shown. */
  private focusNameOnMenu = false;

  private focusName(): void {
    const input = el<HTMLInputElement>('driver-name');
    input.focus();
    input.select();
  }

  private setNameWanted(wanted: boolean): void {
    const form = el('driver-form');
    el('driver-hint').hidden = !wanted;
    form.classList.remove('needs-name');
    if (wanted) {
      // Restart the nudge even when it is asked for twice in a row.
      void form.offsetWidth;
      form.classList.add('needs-name');
    }
  }

  private wireKeys(): void {
    window.addEventListener('keydown', (e) => {
      if (isTyping(e)) {
        // The only key the page takes back from a text field: Escape leaves it.
        if (e.code === 'Escape') (e.target as HTMLElement).blur();
        return;
      }
      if (e.code === 'Escape') {
        e.preventDefault();
        if (this.game.runState === 'gameover' || this.game.runState === 'garage') this.game.toMenu();
        else this.game.togglePause();
      }
      if (e.code === 'KeyM') this.game.audio.toggleMute();
    });
  }

  private wireCues(): void {
    this.game.bus.on('run:countdown', ({ remaining }) => {
      this.countdown.hidden = false;
      this.countdown.textContent = remaining > 0 ? String(remaining) : 'GO';
    });

    this.game.bus.on('run:start', () => {
      this.countdown.hidden = true;
      this.written.clear();
    });

    // A crash is worth a frame of colour: the HUD is where the player is
    // looking, and the camera shake alone reads as a bump rather than an end.
    this.game.bus.on('player:crash', ({ with: what }) => {
      if (what === 'barrier') return;
      this.flash.classList.add('on');
      setTimeout(() => this.flash.classList.remove('on'), 90);
    });

    this.game.bus.on('powerup:activate', ({ id }) => {
      const info = POWERUP_INFO[id];
      this.announce(id, info.label, this.game.powerups.wasExtended(id) ? 'Extended' : info.tagline);
    });
    this.game.bus.on('powerup:blocked-crash', ({ id }) => {
      // A ghost blocks every contact for its whole run; only the shield's save
      // is an event worth a banner.
      if (id !== 'shield') return;
      this.shieldSpent = true;
      this.announce('shield', 'Saved!', 'Shield used up');
    });
    this.game.bus.on('powerup:expire', ({ id }) => {
      if (id === 'shield' && this.shieldSpent) {
        this.shieldSpent = false;
        return;
      }
      this.announce(id, `${POWERUP_INFO[id].label} over`, null, true);
    });
    this.game.bus.on('run:start', () => {
      this.shieldSpent = false;
      this.announcer.replaceChildren();
    });

    this.game.bus.on('run:end', ({ score, distance, coins }) => {
      this.text('result-score', score.toLocaleString());
      this.text('result-distance', metres(distance));
      this.text('result-coins', coins.toLocaleString());
      el('result-best').hidden = score < this.game.save.snapshot.best || score === 0;
      this.garageDirty = true;
    });

    for (const cue of ['garage:purchase', 'garage:upgrade', 'garage:equip'] as const) {
      this.game.bus.on(cue, () => {
        this.garageDirty = true;
        this.renderGarage();
      });
    }
  }

  /* ----------------------------------------------------------------- frame */

  update(dt: number): void {
    const state = this.game.runState;
    if (state !== this.lastState) {
      this.lastState = state;
      this.showFor(state);
    }

    this.accumulator += dt;
    if (this.accumulator < 1 / HUD_HZ) return;
    this.accumulator = 0;

    if (state === 'driving' || state === 'paused' || state === 'countdown') this.syncHud();
    if (state === 'menu') this.syncMenu();
  }

  /** Show exactly the screens that belong to `state`, and nothing else. */
  private showFor(state: RunState): void {
    const live = state === 'driving' || state === 'paused' || state === 'countdown';
    this.hud.hidden = !live;
    if (state !== 'countdown') this.countdown.hidden = true;

    const active: Record<RunState, string | null> = {
      menu: 'screen-menu',
      garage: 'screen-garage',
      countdown: null,
      driving: null,
      paused: 'screen-pause',
      gameover: 'screen-gameover',
    };

    for (const id of ['screen-menu', 'screen-garage', 'screen-pause', 'screen-gameover']) {
      el(id).hidden = active[state] !== id;
    }

    if (state === 'menu') {
      this.syncMenu();
      if (this.focusNameOnMenu) {
        this.focusNameOnMenu = false;
        this.focusName();
      }
    }
    if (state === 'garage') this.renderGarage();
  }

  private syncHud(): void {
    const s = this.game;
    const p = s.player;

    this.text('hud-score', Math.round(s.currentScore).toLocaleString());
    this.text('hud-distance', metres(s.distance));
    this.text('hud-speed', String(Math.round(s.speedKmh)));
    this.text('hud-coin-count', s.scoring.runCoins.toLocaleString());

    // The same six-speed box the engine note is pitched from, so the gear on
    // screen agrees with the gear you can hear.
    const fraction = Math.min(p.speed / SPEED.absoluteMax, 1);
    const gear = Math.min(Math.floor(fraction * 6) + 1, 6);
    this.text('hud-gear', p.speed <= SPEED.min + 0.5 ? 'N' : String(gear));

    const chain = s.scoring.comboChain;
    this.combo.hidden = chain === 0;
    if (chain > 0) {
      this.text('hud-combo-mult', `x${s.scoring.multiplier.toFixed(1)}`);
      this.text('hud-combo-chain', `${chain} chain`);
      const left = s.scoring.comboTimeLeft / 3.4;
      this.comboBar.style.transform = `scaleX(${Math.max(0, Math.min(1, left)).toFixed(3)})`;
    }

    this.syncPowerups();
  }

  /**
   * Power-up slots.
   *
   * Rebuilt only when the set of running effects changes; the timers inside
   * are updated in place. Re-creating five nodes twenty times a second would
   * throw away the CSS transitions and churn the layout for no reason.
   */
  private syncPowerups(): void {
    const powerups = this.game.powerups;
    const active = powerups.active;
    const signature = active.join(',');
    if (this.written.get('__pu') !== signature) {
      this.written.set('__pu', signature);
      this.powerupRow.replaceChildren(...active.map((id) => {
        const info = POWERUP_INFO[id];
        const card = document.createElement('div');
        card.className = 'pu';
        card.dataset.powerup = id;
        card.style.setProperty('--pu', powerupCss(id));
        card.innerHTML =
          '<span class="pu-dial">' +
          '<svg class="pu-ring" viewBox="0 0 46 46" aria-hidden="true">' +
          '<circle class="pu-ring-track" cx="23" cy="23" r="19"/>' +
          `<circle class="pu-ring-fill" data-ring="${id}" cx="23" cy="23" r="19" stroke-dasharray="${RING.toFixed(2)}"/>` +
          '</svg>' +
          powerupIcon(id) +
          '</span>' +
          `<span class="pu-text"><b class="pu-name">${info.label}</b><span class="pu-tag">${info.tagline}</span></span>` +
          `<b class="pu-time" data-time="${id}">0.0</b>`;
        return card;
      }));
    }

    for (const id of active) {
      const left = powerups.timeLeft(id);
      const card = this.powerupRow.querySelector<HTMLElement>(`[data-powerup="${id}"]`);
      card?.classList.toggle('ending', left < ENDING_SECONDS);
      const time = card?.querySelector<HTMLElement>(`[data-time="${id}"]`);
      if (time) time.textContent = left.toFixed(1);
      const ring = card?.querySelector<SVGCircleElement>(`[data-ring="${id}"]`);
      if (ring) ring.style.strokeDashoffset = (RING * (1 - powerups.fraction(id))).toFixed(2);
    }

    this.veil.classList.toggle('on', powerups.isActive('slowmo'));
  }

  /**
   * Put a banner up: what was just collected and what it does, or a smaller
   * note that one has ended. The newest replaces whatever is showing, so a
   * burst of pickups never stacks banners over the road.
   */
  private announce(id: PowerupId, title: string, sub: string | null, minor = false): void {
    const card = document.createElement('div');
    card.className = `announce-card${minor ? ' minor' : ''}`;
    card.style.setProperty('--pu', powerupCss(id));
    const badge = document.createElement('span');
    badge.className = 'announce-badge';
    badge.innerHTML = powerupIcon(id);
    const text = document.createElement('span');
    const head = document.createElement('div');
    head.className = 'announce-title';
    head.textContent = title;
    text.append(head);
    if (sub) {
      const line = document.createElement('div');
      line.className = 'announce-sub';
      line.textContent = sub;
      text.append(line);
    }
    card.append(badge, text);
    card.addEventListener('animationend', () => card.remove());
    this.announcer.replaceChildren(card);
  }

  private syncMenu(): void {
    const save = this.game.save.snapshot;
    this.text('menu-coins', this.game.save.coins.toLocaleString());
    this.text('menu-best', Math.round(save.best).toLocaleString());
    this.text('menu-best-distance', metres(save.bestDistance));
    this.text('menu-runs', String(save.runs));
    this.renderLeaderboard();
  }

  private renderLeaderboard(): void {
    const rows = this.game.save.snapshot.leaderboard;
    const signature = rows.map((r) => `${r.name}:${r.score}`).join('|');
    if (this.written.get('__lb') === signature) return;
    this.written.set('__lb', signature);

    const body = el('leaderboard-rows');
    if (rows.length === 0) {
      body.innerHTML = '<tr><td class="lb-empty" colspan="3">No runs yet</td></tr>';
      return;
    }
    body.replaceChildren(...rows.slice(0, 8).map((row, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML =
        `<td class="lb-rank">${i + 1}</td>` +
        `<td class="lb-name"></td>` +
        `<td class="lb-score">${Math.round(row.score).toLocaleString()}</td>`;
      // Player-supplied, so it goes in as text rather than markup.
      tr.querySelector('.lb-name')!.textContent = row.name;
      return tr;
    }));
  }

  /* ---------------------------------------------------------------- garage */

  private renderGarage(): void {
    if (!this.garageDirty && this.game.runState !== 'garage') return;
    this.garageDirty = false;

    this.text('garage-coins', this.game.save.coins.toLocaleString());
    // Rendered on first open rather than at boot: it costs a second WebGL
    // context for a few milliseconds, and a player who never visits the garage
    // should never pay for it.
    renderCarPreviews();
    const list = el('garage-list');
    const roster = this.game.garage.list();
    // Named, so it is plain what you are about to take out.
    const equipped = roster.find((e) => e.equipped);
    this.text('btn-garage-drive', equipped ? `Drive ${equipped.def.name}` : 'Drive');

    list.replaceChildren(...roster.map((entry) => {
      const li = document.createElement('li');
      li.className = `car${entry.equipped ? ' is-equipped' : ''}`;
      li.dataset.car = entry.def.id;

      // A rendered picture of the actual car, falling back to the paint swatch
      // if the preview pass could not get a context.
      const image = previewFor(entry.def.id);
      const figure = document.createElement('div');
      figure.className = 'car-figure';
      if (image) {
        const img = document.createElement('img');
        img.src = image;
        img.alt = `${entry.def.name}, three-quarter view`;
        img.dataset.preview = entry.def.id;
        img.loading = 'lazy';
        figure.append(img);
      } else {
        const swatch = document.createElement('i');
        swatch.className = 'car-swatch';
        swatch.style.background = `#${entry.def.color.toString(16).padStart(6, '0')}`;
        figure.append(swatch);
      }
      li.append(figure);

      const head = document.createElement('div');
      head.className = 'car-head';
      head.innerHTML =
        `<span class="car-name">${entry.def.name}</span>` +
        (entry.equipped ? '<span class="car-tag">Equipped</span>' : '');
      li.append(head);

      const action = document.createElement('div');
      if (!entry.owned) {
        const buy = document.createElement('button');
        buy.className = 'btn';
        buy.type = 'button';
        buy.dataset.buy = entry.def.id;
        buy.disabled = !entry.affordable;
        buy.innerHTML = `<span class="price"><i class="coin-dot"></i>${entry.def.price.toLocaleString()}</span>`;
        buy.addEventListener('click', () => this.game.garage.purchase(entry.def.id));
        action.append(buy);
      } else if (!entry.equipped) {
        const equip = document.createElement('button');
        equip.className = 'btn';
        equip.type = 'button';
        equip.dataset.equip = entry.def.id;
        equip.textContent = 'Equip';
        equip.addEventListener('click', () => this.game.garage.equip(entry.def.id));
        action.append(equip);
      }
      li.append(action);

      const blurb = document.createElement('p');
      blurb.className = 'car-blurb';
      blurb.textContent = entry.def.blurb;
      li.append(blurb);

      if (entry.owned) {
        const stats = document.createElement('div');
        stats.className = 'stats-row';
        for (const stat of STAT_ORDER) {
          const level = entry.levels[stat] ?? 0;
          const price = entry.upgradePrices[stat];
          const chip = document.createElement('div');
          chip.className = 'stat-chip';
          chip.innerHTML =
            `<span class="chip-head"><span class="chip-name">${STAT_LABEL[stat]}</span>` +
            `<span class="chip-level">${level}/${UPGRADE.maxLevel}</span></span>` +
            `<span class="pips">${Array.from({ length: UPGRADE.maxLevel },
              (_, i) => `<i class="pip${i < level ? ' on' : ''}"></i>`).join('')}</span>`;

          const buy = document.createElement('button');
          buy.className = 'chip-buy';
          buy.type = 'button';
          buy.dataset.upgrade = `${entry.def.id}:${stat}`;
          if (price === null) {
            buy.textContent = 'Maxed';
            buy.disabled = true;
          } else {
            buy.textContent = `Upgrade ${price.toLocaleString()}`;
            buy.disabled = this.game.save.coins < price;
            buy.addEventListener('click', () => this.game.garage.upgrade(entry.def.id, stat));
          }
          chip.append(buy);
          stats.append(chip);
        }
        li.append(stats);
      }

      return li;
    }));
  }
}

import { Game } from '@/game/Game';
import { installDevHandle } from '@/dev/DevHandle';

const VERSION = '2.0.0';

const canvas = document.getElementById('stage');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('#stage canvas missing from the document');
}

const game = new Game(canvas);
installDevHandle(game, VERSION);
game.start();

// Provisional entry: the menu and HUD land in the next pass, so for now a run
// begins as soon as the scene is up. The dev handle can restart it with a fixed
// seed at any time.
game.startRun();

const boot = document.getElementById('boot');
if (boot) boot.remove();

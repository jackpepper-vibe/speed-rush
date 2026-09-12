import { Game } from '@/game/Game';
import { UIManager } from '@/ui/UIManager';
import { installDevHandle } from '@/dev/DevHandle';

const VERSION = '2.1.0';

const canvas = document.getElementById('stage');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('#stage canvas missing from the document');
}

const game = new Game(canvas);
game.attach(new UIManager(game));
installDevHandle(game, VERSION);
game.start();

// Open on the menu. The world renders behind it from the first frame, so the
// front screen is the game idling rather than a still image of it.
game.toMenu();

import { Game } from './game';

async function boot(): Promise<void> {
  try {
    if (!window.WebGL2RenderingContext && !window.WebGLRenderingContext) {
      throw new Error('WebGL is not available in this browser.');
    }
    const game = new Game();
    await game.init();
  } catch (err) {
    const txt = document.getElementById('load-text');
    if (txt) {
      txt.textContent = 'Failed to start: ' + (err instanceof Error ? err.message : String(err));
      txt.style.color = '#ff6b6b';
    }
    console.error(err);
  }
}

boot();

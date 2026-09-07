import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// P0 spike only (docs/PIXI_MIGRATION_PLAN.md §6) - reached via ?pixi=1, never in the normal app
// flow. Deleted along with src/tank/render/dev/ once P1 supersedes it.
const isPixiSpike = new URLSearchParams(window.location.search).get('pixi') === '1';

async function mount() {
  const root = createRoot(document.getElementById('root')!);
  if (isPixiSpike) {
    const { PixiSpike } = await import('./tank/render/dev/PixiSpike.tsx');
    root.render(
      <StrictMode>
        <PixiSpike />
      </StrictMode>,
    );
    return;
  }
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

mount();

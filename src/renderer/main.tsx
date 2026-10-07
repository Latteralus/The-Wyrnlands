import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { SimulationProvider } from './sim/SimulationProvider';
import { getBridge, SimulationClient, SimulationStore } from './sim/client';

const root = createRoot(document.getElementById('root')!);
const bridge = getBridge();

if (bridge) {
  const client = new SimulationClient(bridge);
  const store = new SimulationStore(client);
  root.render(
    <StrictMode>
      <SimulationProvider client={client} store={store}>
        <App />
      </SimulationProvider>
    </StrictMode>,
  );
} else {
  // Opened in an ordinary browser (e.g. the bare Vite dev server): the
  // simulation runs in the desktop app's own process, so there's no game here.
  root.render(
    <main className="title-shell">
      <h1>The Wyrnlands</h1>
      <p>The Wyrnlands is a desktop game. Start it with npm run dev (or the installed app).</p>
    </main>,
  );
}

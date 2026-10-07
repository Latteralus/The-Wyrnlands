import { createContext } from 'react';
import type { SimulationClient, SimulationStore } from './client';

export interface SimulationContextValue {
  client: SimulationClient;
  store: SimulationStore;
}

export const SimulationContext = createContext<SimulationContextValue | null>(null);

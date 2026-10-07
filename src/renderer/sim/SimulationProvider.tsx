import { SimulationContext, type SimulationContextValue } from './context';
import type { ReactNode } from 'react';

export function SimulationProvider({
  client,
  store,
  children,
}: SimulationContextValue & { children: ReactNode }) {
  return <SimulationContext.Provider value={{ client, store }}>{children}</SimulationContext.Provider>;
}

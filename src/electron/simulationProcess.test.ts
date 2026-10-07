import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SimulationProcess } from './simulationProcess';
import type { SimInit } from './simControl';

const { fork } = vi.hoisted(() => ({ fork: vi.fn() }));
vi.mock('electron', () => ({ utilityProcess: { fork }, MessageChannelMain: vi.fn() }));

class SimulationChild extends EventEmitter {
  readonly stdout = { pipe: vi.fn() };
  readonly stderr = { pipe: vi.fn() };
  readonly postMessage = vi.fn();
  readonly kill = vi.fn();
}

const init: Omit<SimInit, 'type'> = {
  backend: 'native',
  savesDir: '/scratch/saves',
  logFile: '/scratch/logs/simulation.log',
};

describe('main-process simulation lifecycle', () => {
  let child: SimulationChild;

  beforeEach(() => {
    child = new SimulationChild();
    fork.mockReturnValue(child);
  });

  afterEach(() => vi.clearAllMocks());

  it('can sit idle before startup without creating an unhandled rejection', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const simulation = new SimulationProcess();
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).not.toHaveBeenCalled();
      await expect(simulation.whenReady()).rejects.toThrow('The simulation has not started.');
      await expect(simulation.control('shutdown')).rejects.toThrow('The simulation has not started.');
      expect(fork).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('waits for startup and forwards diagnostics without ending the main output streams', async () => {
    const simulation = new SimulationProcess();
    simulation.start('/app/simHost.cjs', init);
    expect(fork).toHaveBeenCalledWith('/app/simHost.cjs', [], {
      serviceName: 'Wyrnlands Simulation',
      stdio: 'pipe',
    });
    expect(child.stdout.pipe).toHaveBeenCalledWith(process.stdout, { end: false });
    expect(child.stderr.pipe).toHaveBeenCalledWith(process.stderr, { end: false });
    expect(child.postMessage).toHaveBeenCalledWith({ type: 'init', ...init });

    const ready = vi.fn();
    const waiting = simulation.whenReady().then(ready);
    await Promise.resolve();
    expect(ready).not.toHaveBeenCalled();
    child.emit('message', { type: 'ready', backend: 'native' });
    await waiting;
    expect(ready).toHaveBeenCalledOnce();
  });

  it('rejects readiness when the child cannot initialize', async () => {
    const simulation = new SimulationProcess();
    simulation.start('/app/simHost.cjs', init);
    const readiness = expect(simulation.whenReady()).rejects.toThrow('Cannot open the save directory.');
    child.emit('message', { type: 'fatal', message: 'Cannot open the save directory.' });
    await readiness;
  });

  it('rejects startup on an unexpected exit and waits for a fresh child on restart', async () => {
    const simulation = new SimulationProcess();
    const onExit = vi.fn();
    simulation.onUnexpectedExit = onExit;
    simulation.start('/app/simHost.cjs', init);
    const readiness = expect(simulation.whenReady()).rejects.toThrow('The simulation process exited (1).');
    child.emit('exit', 1);
    await readiness;
    expect(onExit).toHaveBeenCalledWith(1);

    const replacement = new SimulationChild();
    fork.mockReturnValue(replacement);
    simulation.start('/app/simHost.cjs', init);
    const ready = vi.fn();
    const waiting = simulation.whenReady().then(ready);
    await Promise.resolve();
    expect(ready).not.toHaveBeenCalled();
    replacement.emit('message', { type: 'ready', backend: 'native' });
    await waiting;
    expect(ready).toHaveBeenCalledOnce();
  });
});

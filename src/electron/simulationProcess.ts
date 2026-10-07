import { MessageChannelMain, utilityProcess, type UtilityProcess, type WebContents } from 'electron';
import type { ControlOp, ControlRequest, ControlResults, FromSimulation, SimInit } from './simControl';

// The main process's handle on the simulation process: starts it, hands
// each renderer page its own MessagePort to it, relays the main-only
// control operations (file paths from native dialogs, shutdown), and
// notices if it dies.
export class SimulationProcess {
  private child: UtilityProcess | null = null;
  private ready: Promise<void> | null = null;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private stopping = false;

  // Called if the process exits when nobody asked it to.
  onUnexpectedExit: ((code: number) => void) | null = null;

  start(entry: string, init: Omit<SimInit, 'type'>): void {
    this.stopping = false;
    const child = utilityProcess.fork(entry, [], { serviceName: 'Wyrnlands Simulation', stdio: 'pipe' });
    this.child = child;
    // Utility-process inherited output doesn't reliably reach the dev terminal
    // on Windows. Relay both streams without closing the main process's output
    // when the child exits (including after a simulation restart).
    child.stdout?.pipe(process.stdout, { end: false });
    child.stderr?.pipe(process.stderr, { end: false });
    this.ready = new Promise<void>((resolve, reject) => {
      child.on('message', (message: FromSimulation) => {
        if (message.type === 'ready') resolve();
        else if (message.type === 'fatal') reject(new Error(message.message));
        else if (message.type === 'control-result') {
          const pending = this.pending.get(message.id);
          if (!pending) return;
          this.pending.delete(message.id);
          if (message.ok) pending.resolve(message.result);
          else pending.reject(new Error(message.message));
        }
      });
      child.once('exit', (code) => {
        reject(new Error(`The simulation process exited (${code}).`));
        for (const { reject: fail } of this.pending.values())
          fail(new Error('The simulation process stopped.'));
        this.pending.clear();
        if (this.child === child) this.child = null;
        if (!this.stopping) this.onUnexpectedExit?.(code);
      });
    });
    // Unobserved until someone awaits it.
    this.ready.catch(() => {});
    child.postMessage({ type: 'init', ...init } satisfies SimInit);
  }

  whenReady(): Promise<void> {
    return this.ready ?? Promise.reject(new Error('The simulation has not started.'));
  }

  // Gives a renderer page its own channel to the simulation. A page that
  // reloads asks again and gets a fresh one; the simulation sees the old
  // one close.
  async connect(target: WebContents): Promise<void> {
    await this.whenReady();
    const child = this.child;
    if (!child || target.isDestroyed()) return;
    const { port1, port2 } = new MessageChannelMain();
    child.postMessage({ type: 'connect' }, [port1]);
    target.postMessage('wyrnlands:simulation-port', null, [port2]);
  }

  async control<Op extends ControlOp>(
    op: Op,
    ...args: Op extends 'exportTo' | 'importFrom' ? [file: string] : []
  ): Promise<ControlResults[Op]> {
    await this.whenReady();
    const child = this.child;
    if (!child) throw new Error('The simulation process is not running.');
    const id = this.nextId++;
    const request = { type: 'control', id, op, ...(args.length ? { file: args[0] } : {}) } as ControlRequest;
    // Exports/imports of big saves can take a while; nothing else should.
    const timeoutMs = op === 'exportTo' || op === 'importFrom' ? 300_000 : 30_000;
    return new Promise<ControlResults[Op]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`The simulation did not answer (${op}).`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as ControlResults[Op]);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      child.postMessage(request);
    });
  }

  // Asks the simulation to stop the clock, save and close its database,
  // waits for it to say it has, then ends the process. If it doesn't answer
  // in time the process is ended anyway: a file-backed save is then exactly
  // as of the last committed batch of ticks.
  async stop(timeoutMs = 15_000): Promise<void> {
    this.stopping = true;
    try {
      if (this.child)
        await Promise.race([
          this.control('shutdown'),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Shutdown timed out.')), timeoutMs)),
        ]);
    } finally {
      this.child?.kill();
      this.child = null;
    }
  }
}

import type { ActionDefinition } from './types';

// Action definitions are code, not data, for now — they're behavior
// (resolve functions), and only production/recipes (later modules) need the
// data-driven treatment MASTERPLAN.md §16 describes for goods/recipes.
export class ActionRegistry {
  private definitions = new Map<string, ActionDefinition>();

  register(definition: ActionDefinition): void {
    this.definitions.set(definition.type, definition);
  }

  get(type: string): ActionDefinition {
    const definition = this.definitions.get(type);
    if (!definition) throw new Error(`Unknown action type: "${type}"`);
    return definition;
  }
}

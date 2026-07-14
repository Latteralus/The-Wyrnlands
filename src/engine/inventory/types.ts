export type ItemStatus = 'active' | 'consumed' | 'spoiled' | 'worn_out';
export type DestructionReason = Exclude<ItemStatus, 'active'>;

export interface Item {
  id: string;
  type: string;
  qualityTier: number;
  containerId: string;
  status: ItemStatus;
  createdAtTick: number;
  destroyedAtTick: number | null;
}

export type ProvenanceEventType = 'produced' | 'transferred' | DestructionReason;

export interface ProvenanceEvent {
  id: number;
  itemId: string;
  tick: number;
  eventType: ProvenanceEventType;
  actorId: string | null;
  fromContainerId: string | null;
  toContainerId: string | null;
  note: string | null;
}

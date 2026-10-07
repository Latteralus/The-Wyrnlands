export interface SaveMetadata {
  id: string;
  kind: 'autosave' | 'manual' | 'import';
  displayName: string;
  characterName: string;
  tick: number;
  year: number;
  season: string;
  day: number;
  worldSeed: string;
  createdAt: string;
  updatedAt: string;
  gameVersion: string;
  saveFormatVersion: number;
}

export interface StoredSave {
  metadata: SaveMetadata;
  bytes: Uint8Array;
}

export function selectContinueSave(saves: SaveMetadata[]): SaveMetadata | null {
  return (
    [...saves].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))[0] ?? null
  );
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Could not access local saves.'));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(new Error('Local save failed. Check available browser storage.'));
    tx.onerror = () => reject(new Error('Local save failed. Check available browser storage.'));
  });
}

export class SaveStore {
  private database: Promise<IDBDatabase> | null = null;
  private factory: IDBFactory;
  private name: string;
  constructor(factory: IDBFactory = indexedDB, name = 'wyrnlands-saves') {
    this.factory = factory;
    this.name = name;
  }

  private open(): Promise<IDBDatabase> {
    if (!this.database) {
      this.database = new Promise((resolve, reject) => {
        const request = this.factory.open(this.name, 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore('metadata', { keyPath: 'id' });
          request.result.createObjectStore('bytes');
        };
        request.onsuccess = () => {
          request.result.onversionchange = () => {
            request.result.close();
            this.database = null;
          };
          resolve(request.result);
        };
        request.onerror = () => {
          this.database = null;
          reject(new Error('Local saves are unavailable in this browser.'));
        };
        request.onblocked = () => {
          this.database = null;
          reject(new Error('Close other game tabs to open local saves.'));
        };
      });
    }
    return this.database;
  }

  async list(): Promise<SaveMetadata[]> {
    const db = await this.open();
    const tx = db.transaction('metadata', 'readonly');
    const done = transactionDone(tx);
    const [result] = await Promise.all([
      requestResult(tx.objectStore('metadata').getAll() as IDBRequest<SaveMetadata[]>),
      done,
    ]);
    return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string): Promise<StoredSave | null> {
    const db = await this.open();
    const tx = db.transaction(['metadata', 'bytes'], 'readonly');
    const done = transactionDone(tx);
    const [metadata, bytes] = await Promise.all([
      requestResult(tx.objectStore('metadata').get(id) as IDBRequest<SaveMetadata | undefined>),
      requestResult(tx.objectStore('bytes').get(id) as IDBRequest<Uint8Array | undefined>),
      done,
    ]);
    return metadata && bytes ? { metadata, bytes } : null;
  }

  async put(save: StoredSave): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(['metadata', 'bytes'], 'readwrite');
    const done = transactionDone(tx);
    try {
      tx.objectStore('metadata').put(save.metadata);
      tx.objectStore('bytes').put(save.bytes, save.metadata.id);
    } catch {
      tx.abort();
    }
    await done;
  }

  async delete(id: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(['metadata', 'bytes'], 'readwrite');
    const done = transactionDone(tx);
    tx.objectStore('metadata').delete(id);
    tx.objectStore('bytes').delete(id);
    await done;
  }
}

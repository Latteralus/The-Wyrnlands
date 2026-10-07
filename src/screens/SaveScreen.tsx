import { useState } from 'react';
import type { SaveMetadata } from '../persistence/saveStore';

export function SaveScreen({
  saves,
  canSave,
  busy,
  onSave,
  onLoad,
  onDelete,
  onImport,
  onExport,
  onBack,
}: {
  saves: SaveMetadata[];
  canSave: boolean;
  busy: boolean;
  onSave: (name: string, slot?: SaveMetadata) => void;
  onLoad: (save: SaveMetadata) => void;
  onDelete: (id: string) => void;
  onImport: (file: File) => void;
  onExport: () => void;
  onBack: () => void;
}) {
  const [name, setName] = useState('My life in Oakford');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmOverwrite, setConfirmOverwrite] = useState<string | null>(null);
  return (
    <section className="player-panel save-panel">
      <h2>{canSave ? 'Save & load' : 'Load game'}</h2>
      <p>
        Saves stay in this browser. Export a .sqlite file to keep a portable copy. Continue resumes the most
        recently saved slot.
      </p>
      {canSave && (
        <form
          className="panel-actions"
          onSubmit={(e) => {
            e.preventDefault();
            onSave(name);
          }}
        >
          <label>
            Save name
            <input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <button type="submit" disabled={busy}>
            Create manual save
          </button>
          <button type="button" onClick={onExport} disabled={busy}>
            Export Save
          </button>
        </form>
      )}
      <label className="import-label">
        Import Save (.sqlite)
        <input
          type="file"
          accept=".sqlite"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onImport(file);
            e.target.value = '';
          }}
        />
      </label>
      {saves.length === 0 && <p>No local saves yet.</p>}
      <div className="save-list">
        {saves.map((save) => (
          <article key={save.id}>
            <h3>{save.displayName}</h3>
            <p>
              {save.characterName} · Year {save.year}, {save.season}, day {save.day}
            </p>
            <p>
              Saved {new Date(save.updatedAt).toLocaleString()} · {save.kind}
            </p>
            <div className="panel-actions">
              <button onClick={() => onLoad(save)} disabled={busy}>
                Load {save.displayName}
              </button>
              {canSave &&
                save.kind === 'manual' &&
                (confirmOverwrite === save.id ? (
                  <>
                    <span>Overwrite this slot?</span>
                    <button
                      disabled={busy}
                      onClick={() => {
                        setConfirmOverwrite(null);
                        onSave(save.displayName, save);
                      }}
                    >
                      Confirm overwrite
                    </button>
                    <button onClick={() => setConfirmOverwrite(null)}>Cancel</button>
                  </>
                ) : (
                  <button disabled={busy} onClick={() => setConfirmOverwrite(save.id)}>
                    Overwrite
                  </button>
                ))}
              {confirmDelete === save.id ? (
                <>
                  <span>Delete this save?</span>
                  <button
                    disabled={busy}
                    onClick={() => {
                      setConfirmDelete(null);
                      onDelete(save.id);
                    }}
                  >
                    Confirm delete
                  </button>
                  <button onClick={() => setConfirmDelete(null)}>Cancel</button>
                </>
              ) : (
                <button disabled={busy} onClick={() => setConfirmDelete(save.id)}>
                  Delete
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      <button onClick={onBack} disabled={busy}>
        Back
      </button>
    </section>
  );
}

import { useState } from 'react';
import type { SaveMetadata } from '../../shared/protocol';

export function SaveScreen({
  saves,
  activeSaveId,
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
  // The save the running game lives in (it can't be deleted from under it).
  activeSaveId: string | null;
  canSave: boolean;
  busy: boolean;
  onSave: (name: string, slot?: SaveMetadata) => void;
  onLoad: (save: SaveMetadata) => void;
  onDelete: (id: string) => void;
  onImport: () => void;
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
        Saves are kept in your Wyrnlands data folder. Export a .sqlite file to keep a portable copy. Continue
        resumes the most recently saved game.
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
      <div className="panel-actions">
        <button type="button" onClick={onImport} disabled={busy}>
          Import Save (.sqlite)
        </button>
      </div>
      {saves.length === 0 && <p>No saves yet.</p>}
      <div className="save-list">
        {saves.map((save) => (
          <article key={save.id}>
            <h3>{save.displayName}</h3>
            <p>
              {save.characterName} · Year {save.year}, {save.season}, day {save.day}
            </p>
            <p>
              Saved {new Date(save.updatedAt).toLocaleString()} · {save.kind}
              {save.id === activeSaveId && ' · in play'}
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
              {save.id === activeSaveId ? null : confirmDelete === save.id ? (
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

import { SceneHeader } from '../components/SceneHeader';
import { getLocationContent } from '../data/locationContent';
import type { Site, UiApi } from '../engine/ui-api';

interface LocationScreenProps {
  uiApi: UiApi;
  site: Site;
  playerId: string;
  onBack: () => void;
  onAction: () => void;
}

// §5.5 Location panels: "illustration, atmospheric description (conditional
// on season/scarcity/time), presence roster, available actions." Presence
// rosters stay a stub until NPCs exist (Stage 4); actions are the Stage 1
// dummy timed actions proving the queue/progress/log pipeline end to end.
export function LocationScreen({ uiApi, site, playerId, onBack, onAction }: LocationScreenProps) {
  const calendar = uiApi.getCalendar();
  const content = getLocationContent(site.kind);

  const handleAction = (type: string) => {
    uiApi.queueAction(playerId, type);
    onAction();
  };

  return (
    <section>
      <SceneHeader icon={content.icon} title={site.name} calendar={calendar} />

      <button type="button" className="back-button" onClick={onBack}>
        ← Back to settlement
      </button>

      <p className="location-description">{content.description}</p>

      <h3>{"Who's here"}</h3>
      <p className="presence-roster-stub">You are here. NPCs arrive in Stage 4.</p>

      <h3>What you can do</h3>
      <div className="location-actions">
        {content.actions.length === 0 && <p>Nothing to do here yet.</p>}
        {content.actions.map((action) => (
          <button key={action.type} type="button" onClick={() => handleAction(action.type)}>
            {action.label}
          </button>
        ))}
      </div>
    </section>
  );
}

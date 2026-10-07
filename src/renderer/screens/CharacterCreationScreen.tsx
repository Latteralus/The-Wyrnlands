import { useState } from 'react';
import {
  IMPLEMENTED_SKILLS,
  MAX_SKILL_LEVEL,
  getXpForSkillLevel,
  listGoodDefinitions,
} from '../../shared/gameRules';
import type { NewGameConfig } from '../../shared/protocol';

export function CharacterCreationScreen({
  onCreate,
  onBack,
  busy,
}: {
  onCreate: (config: NewGameConfig) => void;
  onBack: () => void;
  busy: boolean;
}) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [preset, setPreset] = useState<'standard' | 'custom'>('standard');
  const [seed, setSeed] = useState(() => `oakford-${crypto.randomUUID().slice(0, 8)}`);
  const [season, setSeason] = useState('rolled');
  const [coin, setCoin] = useState(100);
  const [levels, setLevels] = useState<Record<string, number>>({});
  const [items, setItems] = useState<Record<string, number>>({ shoes: 1 });
  const goods = listGoodDefinitions();
  return (
    <section className="player-panel creation-panel">
      <p className="eyebrow">A new life in Oakford</p>
      <h2>Create your character</h2>
      <p>
        Arrive with a little savings and learn a trade. A steady wage comes before a home or a business of
        your own.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onCreate({
            world: { seed, ...(season === 'rolled' ? {} : { startSeasonIndex: Number(season) }) },
            character: {
              firstName,
              lastName,
              preset,
              ...(preset === 'custom'
                ? {
                    coin,
                    skillXp: Object.fromEntries(
                      IMPLEMENTED_SKILLS.map((skill) => [skill, getXpForSkillLevel(levels[skill] ?? 0)]),
                    ),
                    items: goods
                      .filter((good) => (items[good.type] ?? 0) > 0)
                      .map((good) => ({
                        goodType: good.type,
                        quantity: items[good.type] ?? 0,
                        ...(good.slot && items[good.type] === 1 ? { equipped: true } : {}),
                      })),
                  }
                : {}),
            },
          });
        }}
      >
        <div className="form-grid">
          <label>
            First name
            <input
              required
              maxLength={60}
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              autoComplete="given-name"
            />
          </label>
          <label>
            Last name
            <input
              required
              maxLength={60}
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              autoComplete="family-name"
            />
          </label>
          <label>
            Starting preset
            <select value={preset} onChange={(e) => setPreset(e.target.value as 'standard' | 'custom')}>
              <option value="standard">Standard</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <label>
            World seed
            <input required maxLength={200} value={seed} onChange={(e) => setSeed(e.target.value)} />
          </label>
          <label>
            Starting season
            <select value={season} onChange={(e) => setSeason(e.target.value)}>
              <option value="rolled">Roll with the world</option>
              {['Spring', 'Summer', 'Autumn', 'Winter'].map((s, i) => (
                <option key={s} value={i}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>
        {preset === 'standard' ? (
          <p className="start-summary">
            100 coin · worn shoes · patched cloak in winter · all skills at zero · no land or business. Tavern
            bunks are paid per stay; rough sleeping is always available.
          </p>
        ) : (
          <>
            <label>
              Starting coin
              <input
                type="number"
                min={0}
                max={1000000}
                step={1}
                required
                value={Number.isNaN(coin) ? '' : coin}
                onChange={(e) => setCoin(e.target.valueAsNumber)}
              />
            </label>
            <details>
              <summary>Belongings — quantities (20 kg maximum)</summary>
              <div className="form-grid">
                {goods.map((good) => (
                  <label key={good.type}>
                    {good.type} · {good.weightKg} kg each
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={items[good.type] ?? 0}
                      onChange={(e) => setItems({ ...items, [good.type]: e.target.valueAsNumber })}
                      required
                    />
                  </label>
                ))}
              </div>
              <p>
                A single pair of shoes or cloak is worn automatically. Custom items replace the Standard kit.
              </p>
            </details>
          </>
        )}
        <details open>
          <summary>Skills — starting levels (0–{MAX_SKILL_LEVEL})</summary>
          <div className="form-grid">
            {IMPLEMENTED_SKILLS.map((skill) => (
              <label key={skill}>
                {skill}
                <select
                  aria-label={skill}
                  value={preset === 'standard' ? 0 : (levels[skill] ?? 0)}
                  disabled={preset === 'standard'}
                  onChange={(e) => setLevels({ ...levels, [skill]: Number(e.target.value) })}
                >
                  {Array.from({ length: MAX_SKILL_LEVEL + 1 }, (_, level) => (
                    <option key={level} value={level}>
                      Level {level}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </details>
        <div className="panel-actions">
          <button type="button" onClick={onBack} disabled={busy}>
            Back
          </button>
          <button className="primary-button" disabled={busy} type="submit">
            {busy ? 'Creating your world…' : 'Begin your life'}
          </button>
        </div>
      </form>
    </section>
  );
}

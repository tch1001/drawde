import { useState } from 'react';
import { PROVIDERS, settingsStore, useSettings, type ProviderId } from './providers';

/**
 * API-key settings. Bring-your-own-key across providers: keys are the user's,
 * stay on their device, and each is sent only to its own provider.
 */
export function Settings({ onClose }: { onClose: () => void }) {
  const { keys, persisted } = useSettings();
  const [draft, setDraft] = useState<Partial<Record<ProviderId, string>>>({ ...keys });
  const [remember, setRemember] = useState(persisted);
  const [reveal, setReveal] = useState<ProviderId | null>(null);

  const save = () => {
    settingsStore.setKeys(draft, remember);
    onClose();
  };

  return (
    <div className="dd-modal-scrim dd-no-interaction" onPointerDown={onClose}>
      <div className="dd-modal" onPointerDown={(e) => e.stopPropagation()}>
        <header className="dd-modal-head">
          <h2>API keys</h2>
          <button className="dd-modal-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="dd-modal-body">
          <p className="dd-note">
            Add a key for any provider you want to use — you can pick the model
            afterwards. Only models whose provider has a key are selectable.
          </p>

          {PROVIDERS.map((p) => (
            <label className="dd-field" key={p.id}>
              <span>
                {p.label}
                <a href={p.keysUrl} target="_blank" rel="noreferrer noopener">
                  get a key ↗
                </a>
              </span>
              <div className="dd-key-row">
                <input
                  type={reveal === p.id ? 'text' : 'password'}
                  value={draft[p.id] ?? ''}
                  onChange={(e) => setDraft({ ...draft, [p.id]: e.target.value })}
                  placeholder={p.keyPrefix ? `${p.keyPrefix}…` : 'API key'}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="dd-reveal"
                  onClick={() => setReveal(reveal === p.id ? null : p.id)}
                >
                  {reveal === p.id ? 'hide' : 'show'}
                </button>
              </div>
            </label>
          ))}

          <label className="dd-check">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            <span>
              Remember on this device
              <em>
                Off: keys are kept for this tab only and forgotten when you close
                it. On: they are stored in this browser until you clear them.
              </em>
            </span>
          </label>

          <p className="dd-note">
            Each key is sent only to its own provider, directly from this page —
            drawde has no server and never sees them. Use keys scoped with a
            spend limit: anything running in this page could read them.
          </p>

          <p className="dd-note">
            Equation OCR runs entirely in your browser and needs no key at all. A
            key is required only for chatting about the selections.
          </p>
        </div>

        <footer className="dd-modal-foot">
          <button
            className="dd-danger"
            onClick={() => {
              settingsStore.setKeys({}, false);
              setDraft({});
              onClose();
            }}
          >
            Remove all
          </button>
          <button className="dd-primary" onClick={save}>
            Save
          </button>
        </footer>
      </div>
    </div>
  );
}

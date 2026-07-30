import { useState } from 'react';
import { apiKeyStore, useApiKey } from './llm';

/**
 * API-key settings. Bring-your-own-key: the key is the user's, stays on their
 * device, and is sent only to api.anthropic.com.
 */
export function Settings({ onClose }: { onClose: () => void }) {
  const { key, persisted } = useApiKey();
  const [draft, setDraft] = useState(key ?? '');
  const [remember, setRemember] = useState(persisted);
  const [reveal, setReveal] = useState(false);

  const save = () => {
    apiKeyStore.set(draft.trim() || null, remember);
    onClose();
  };

  return (
    <div className="dd-modal-scrim dd-no-interaction" onPointerDown={onClose}>
      <div className="dd-modal" onPointerDown={(e) => e.stopPropagation()}>
        <header className="dd-modal-head">
          <h2>Settings</h2>
          <button className="dd-modal-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="dd-modal-body">
          <label className="dd-field">
            <span>Anthropic API key</span>
            <div className="dd-key-row">
              <input
                type={reveal ? 'text' : 'password'}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="sk-ant-..."
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                className="dd-reveal"
                onClick={() => setReveal((v) => !v)}
              >
                {reveal ? 'hide' : 'show'}
              </button>
            </div>
          </label>

          <label className="dd-check">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            <span>
              Remember on this device
              <em>
                Off: the key is kept for this tab only and forgotten when you close
                it. On: it is stored in this browser until you clear it.
              </em>
            </span>
          </label>

          <p className="dd-note">
            Your key is sent only to <code>api.anthropic.com</code>, directly from
            this page — drawde has no server and never sees it. Use a key scoped
            with a spend limit: anything running in this page could read it.
          </p>

          <p className="dd-note">
            Equation OCR runs entirely in your browser and needs no key. A key is
            required only for chatting about the selections.
          </p>
        </div>

        <footer className="dd-modal-foot">
          {key && (
            <button
              className="dd-danger"
              onClick={() => {
                apiKeyStore.set(null, false);
                setDraft('');
                onClose();
              }}
            >
              Remove key
            </button>
          )}
          <button className="dd-primary" onClick={save}>
            Save
          </button>
        </footer>
      </div>
    </div>
  );
}

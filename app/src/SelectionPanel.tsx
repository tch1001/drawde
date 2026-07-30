import { useState } from 'react';
import { useRegions, regionStore } from './store';
import { chatStore, useChat } from './chat';
import { useApiKey } from './llm';
import type { Region } from './types';

/** What the button asks when the user hasn't typed a question of their own. */
const DEFAULT_ASK =
  'Explain what these selections show, and fill in any derivation steps the paper skipped between them.';

function RegionCard({ region, index }: { region: Region; index: number }) {
  return (
    <div className="dd-card">
      <div className="dd-card-head">
        <span className={`dd-kind dd-kind-${region.kind}`}>
          {region.kind === 'box' ? '▭ region' : 'T text'}
        </span>
        <span className="dd-card-meta">
          #{index + 1} · p.{region.pageIndex + 1}
        </span>
        <button className="dd-card-x" title="Remove" onClick={() => regionStore.remove(region.id)}>
          ×
        </button>
      </div>

      {region.kind === 'box' ? (
        region.imageUrl ? (
          <img className="dd-crop" src={region.imageUrl} alt={`selection ${index + 1}`} />
        ) : (
          <div className="dd-crop-pending">rendering crop…</div>
        )
      ) : (
        <div className="dd-text">{region.text || <em>(no text)</em>}</div>
      )}

      {/* OCR output, once recognised. Editable-looking but read-only for now —
          it is a hint to the model, which also sees the image. */}
      {region.kind === 'box' && region.ocrState === 'running' && (
        <div className="dd-latex dd-latex-pending">reading equation…</div>
      )}
      {region.kind === 'box' && region.latex && (
        <div className="dd-latex" title="LaTeX from in-browser OCR">
          {region.latex}
        </div>
      )}
      {region.kind === 'box' && region.ocrState === 'error' && (
        <div className="dd-latex dd-latex-error">
          OCR failed — the model will still read the image.
        </div>
      )}

      <div className="dd-card-foot">
        {region.kind === 'box' && (
          <>
            {Math.round(region.rect.size.width)}×{Math.round(region.rect.size.height)} pt
            <span className="dd-dot">·</span>
          </>
        )}
        {region.kind === 'text' && region.text && (
          <>
            {region.text.length} chars
            <span className="dd-dot">·</span>
          </>
        )}
        <span className="dd-stub">
          {region.latex ? 'OCR ✓' : region.kind === 'box' ? 'OCR on ask' : 'text layer'}
        </span>
      </div>
    </div>
  );
}

export function SelectionPanel({
  width,
  onClose,
  onOpenSettings,
}: {
  width?: number;
  onClose?: () => void;
  onOpenSettings?: () => void;
}) {
  const regions = useRegions();
  const chat = useChat();
  const { key } = useApiKey();
  const [followUp, setFollowUp] = useState('');

  return (
    <aside className="dd-panel dd-no-interaction" style={width ? { width } : undefined}>
      <header className="dd-panel-head">
        <h2>Context</h2>
        <span className="dd-count">{regions.length}</span>
        <button
          className="dd-gear"
          onClick={onOpenSettings}
          title={key ? 'API key set — settings' : 'Add an API key to chat'}
        >
          {key ? '⚙' : '⚙!'}
        </button>
        {regions.length > 0 && (
          <button className="dd-clear" onClick={() => regionStore.clear()}>
            clear all
          </button>
        )}
        {onClose && (
          <button className="dd-panel-close" onClick={onClose} aria-label="Close panel">
            ×
          </button>
        )}
      </header>

      <div className="dd-panel-body">
        {regions.length === 0 && chat.messages.length === 0 ? (
          <div className="dd-empty">
            <p>Nothing selected yet.</p>
            <ul>
              <li>
                <b>▭ Region</b> <kbd>R</kbd> → drag a box around an equation
              </li>
              <li>
                <b>T Text</b> <kbd>T</kbd> → drag to select text
              </li>
              <li>
                <b>🔒 Lock</b> <kbd>L</kbd> → new selections <b>add</b> instead of
                replacing. Holding <kbd>Shift</kbd> does the same while held.
              </li>
            </ul>
            <p className="dd-empty-note">
              Selections of both kinds collect here as <code>Region</code> objects — the
              same payload that will be piped to OCR and the LLM.
            </p>
          </div>
        ) : (
          <>
            {regions.map((r, i) => (
              <RegionCard key={r.id} region={r} index={i} />
            ))}
            {chat.messages.length > 0 && (
              <div className="dd-thread">
                {chat.messages.map((m) => (
                  <div key={m.id} className={`dd-msg dd-msg-${m.role}`}>
                    {m.text && <div className="dd-msg-text">{m.text}</div>}
                    {m.streaming && !m.text && <span className="dd-typing">…</span>}
                    {m.error && <div className="dd-msg-error">{m.error}</div>}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {(regions.length > 0 || chat.messages.length > 0) && (
        <footer className="dd-panel-foot">
          {chat.status && (
            <div className="dd-progress">
              {chat.status}
              {chat.modelProgress != null && (
                <span className="dd-progress-bar">
                  <span style={{ width: `${Math.round(chat.modelProgress * 100)}%` }} />
                </span>
              )}
            </div>
          )}

          {chat.messages.length > 0 ? (
            <div className="dd-ask-row">
              <input
                className="dd-ask-input"
                value={followUp}
                placeholder="Ask a follow-up…"
                onChange={(e) => setFollowUp(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && followUp.trim() && !chat.busy) {
                    const q = followUp.trim();
                    setFollowUp('');
                    chatStore.ask(q);
                  }
                }}
                disabled={chat.busy}
              />
              <button
                className="dd-primary"
                disabled={chat.busy || !followUp.trim()}
                onClick={() => {
                  const q = followUp.trim();
                  setFollowUp('');
                  chatStore.ask(q);
                }}
              >
                Send
              </button>
            </div>
          ) : (
            <button
              className="dd-primary"
              disabled={chat.busy}
              onClick={() => chatStore.ask(DEFAULT_ASK)}
            >
              {chat.busy
                ? 'Working…'
                : `Ask drawde about ${regions.length} item${regions.length > 1 ? 's' : ''}`}
            </button>
          )}

          {chat.busy && (
            <button className="dd-linkbtn" onClick={() => chatStore.stop()}>
              stop
            </button>
          )}
          {!chat.busy && chat.messages.length > 0 && (
            <button className="dd-linkbtn" onClick={() => chatStore.clear()}>
              clear chat
            </button>
          )}
        </footer>
      )}
    </aside>
  );
}

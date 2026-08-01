import { useLayoutEffect, useRef, useState } from 'react';
import { useRegions, regionStore } from './store';
import { chatStore, useChat } from './chat';
import { settingsStore, useSettings, FONT_MIN, FONT_MAX, FONT_STEP } from './providers';
import { Markdown } from './Markdown';
import { LatexPreview, LatexEditor } from './LatexEditor';
import type { Region } from './types';

/** Grow to fit the text, then scroll rather than pushing the thread off screen. */
const COMPOSER_MAX_LINES = 5;

/**
 * Chat composer: a textarea that grows with its content up to
 * COMPOSER_MAX_LINES, then scrolls, with a compact arrow send button.
 *
 * Enter sends, Shift+Enter inserts a newline — the convention everywhere else,
 * and the reason the field needs to be multi-line in the first place.
 */
function Composer({
  value,
  onChange,
  onSend,
  onStop,
  busy,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  placeholder: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Resize after every render that changes the value, not just on keystrokes —
  // clearing the field after send has to shrink it back too.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || 18;
    const chrome =
      parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) +
      parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    const max = line * COMPOSER_MAX_LINES + chrome;
    el.style.height = 'auto'; // collapse first, or scrollHeight only ever grows
    const next = Math.min(el.scrollHeight, max);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }, [value]);

  const canSend = !busy && value.trim().length > 0;

  return (
    <div className="dd-composer">
      <textarea
        ref={ref}
        className="dd-composer-input"
        rows={1}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (canSend) onSend();
          }
        }}
      />
      <button
        className="dd-send"
        onClick={() => (busy ? onStop() : onSend())}
        disabled={!busy && !canSend}
        title={busy ? 'Stop' : 'Send  (Enter)'}
        aria-label={busy ? 'Stop' : 'Send'}
      >
        {busy ? '■' : '↑'}
      </button>
    </div>
  );
}

/**
 * `readOnly` renders a selection that has already been sent: it is a record of
 * what a question was asked about, so removing it or re-editing its LaTeX would
 * misrepresent the exchange rather than fix anything.
 */
function RegionCard({
  region,
  index,
  readOnly,
}: {
  region: Region;
  index: number;
  readOnly?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div className={`dd-card ${readOnly ? 'is-sent' : ''}`}>
      <div className="dd-card-head">
        <span className={`dd-kind dd-kind-${region.kind}`}>
          {region.kind === 'box' ? '▭ region' : 'T text'}
        </span>
        <span className="dd-card-meta">
          #{index + 1} · p.{region.pageIndex + 1}
        </span>
        {!readOnly && (
          <button
            className="dd-card-x"
            title="Remove"
            onClick={() => regionStore.remove(region.id)}
          >
            ×
          </button>
        )}
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
        <div className="dd-latex">
          <LatexPreview tex={region.latex} />
          {!readOnly && (
            <button
              className="dd-latex-edit"
              onClick={() => setEditing(true)}
              title="OCR wrong? Edit the LaTeX"
            >
              edit
            </button>
          )}
        </div>
      )}
      {editing && (
        <LatexEditor
          initial={region.latex ?? ''}
          cropUrl={region.imageUrl}
          onClose={() => setEditing(false)}
          onSave={(tex) => {
            regionStore.update(region.id, { latex: tex, ocrState: 'done' });
            setEditing(false);
          }}
        />
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
          {region.latex
            ? 'OCR ✓'
            : region.kind === 'box'
              ? region.ocrState === 'error'
                ? 'OCR failed'
                : 'reading…'
              : 'text layer'}
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
  const settings = useSettings();
  const [followUp, setFollowUp] = useState('');

  const available = settingsStore.availableModels();
  const active = settingsStore.activeModel();
  const hasKey = available.length > 0;

  return (
    <aside
      className="dd-panel dd-no-interaction"
      // Scopes the text-size preference to this pane: everything that renders
      // words — thread, cards, composer — is sized off this one variable.
      style={{ ...(width ? { width } : {}), ['--dd-chat-scale' as any]: settings.fontScale }}
    >
      <header className="dd-panel-head">
        <h2>Context</h2>
        <span className="dd-count">{regions.length}</span>
        <button
          className="dd-gear"
          onClick={onOpenSettings}
          title={hasKey ? 'API keys' : 'Add an API key to chat'}
        >
          {hasKey ? '⚙' : '⚙!'}
        </button>
        {regions.length > 0 && (
          <button className="dd-clear" onClick={() => regionStore.clear()}>
            clear all
          </button>
        )}
        <span className="dd-fontsize" title="Chat text size">
          <button
            onClick={() => settingsStore.bumpFontScale(-FONT_STEP)}
            disabled={settings.fontScale <= FONT_MIN}
            aria-label="Smaller chat text"
          >
            A−
          </button>
          <button
            className="dd-fontsize-val"
            onClick={() => settingsStore.resetFontScale()}
            title="Reset to 100%"
          >
            {Math.round(settings.fontScale * 100)}%
          </button>
          <button
            onClick={() => settingsStore.bumpFontScale(FONT_STEP)}
            disabled={settings.fontScale >= FONT_MAX}
            aria-label="Larger chat text"
          >
            A+
          </button>
        </span>
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
            {/* Selections live down by the composer once a conversation exists
                — see the context strip in the footer. Before that they are the
                only content, so they sit here. */}
            {chat.messages.length === 0 &&
              regions.map((r, i) => <RegionCard key={r.id} region={r} index={i} />)}
            {chat.messages.length > 0 && (
              <div className="dd-thread">
                {chat.messages.map((m) => (
                  <div key={m.id} className={`dd-msg dd-msg-${m.role}`}>
                    {/* What this question was asked about, frozen at send time
                        — the live context was emptied so the next question can
                        start from a clean selection. */}
                    {!!m.contexts?.length && (
                      <div className="dd-msg-context">
                        <div className="dd-msg-context-label">
                          asked with {m.contexts.length} selection
                          {m.contexts.length > 1 ? 's' : ''}
                        </div>
                        {m.contexts.map((r, i) => (
                          <RegionCard key={r.id} region={r} index={i} readOnly />
                        ))}
                      </div>
                    )}
                    {m.text &&
                      (m.role === 'assistant' ? (
                        // model output: markdown + LaTeX, sanitised
                        <div className="dd-msg-text">
                          <Markdown text={m.text} />
                        </div>
                      ) : (
                        // the user's own words stay plain text
                        <div className="dd-msg-text">{m.text}</div>
                      ))}
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

          {/* Once a conversation is going, the selections move down here beside
              the composer: after a long answer they'd otherwise be scrolled far
              off the top, exactly when you want to check what you're asking
              about. Capped and scrollable so they can't crowd out the thread. */}
          {chat.messages.length > 0 && regions.length > 0 && (
            <div className="dd-context-strip">
              {regions.map((r, i) => (
                <RegionCard key={r.id} region={r} index={i} />
              ))}
            </div>
          )}

          {/* Only models whose provider has a key are offered; without any key
              the control becomes a prompt to add one. */}
          <div className="dd-modelbar">
            {hasKey ? (
              <select
                className="dd-modelpick"
                value={active?.id ?? ''}
                onChange={(e) => settingsStore.setModel(e.target.value)}
                disabled={chat.busy}
                title="Model"
              >
                {available.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            ) : (
              <button className="dd-modelpick dd-modelpick-empty" onClick={onOpenSettings}>
                Add an API key to choose a model →
              </button>
            )}
          </div>

          {/* The composer is the only way in: the question is always the user's
              own words, never a canned prompt on their behalf. */}
          <Composer
            value={followUp}
            onChange={setFollowUp}
            busy={chat.busy}
            placeholder={
              chat.messages.length > 0
                ? 'Ask a follow-up…'
                : regions.length > 0
                  ? `Ask about ${regions.length} selection${regions.length > 1 ? 's' : ''}…`
                  : 'Ask drawde…'
            }
            onSend={() => {
              const q = followUp.trim();
              if (!q) return;
              setFollowUp('');
              chatStore.ask(q);
            }}
            onStop={() => chatStore.stop()}
          />
        </footer>
      )}
    </aside>
  );
}

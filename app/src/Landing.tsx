import { useCallback, useEffect, useRef, useState } from 'react';
import { SAMPLE_PDF } from './pdf-source';
import { deleteSession, listSessions, type StoredSession } from './persist';

/**
 * Live examples rather than prose: each is a real link, so the URL trick can be
 * tried rather than just read about. They also double as the documentation of
 * which shapes are accepted.
 */
const EXAMPLES = [
  { path: 'https://arxiv.org/pdf/1907.04392', note: 'a full PDF link' },
  { path: 'arxiv.org/pdf/1907.04392', note: 'https:// is optional' },
  { path: 'https://arxiv.org/abs/2510.01051', note: 'abstract pages resolve to the PDF' },
  { path: '2510.01051', note: 'or just an arXiv id' },
];

function ago(ts: number): string {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 90) return 'just now';
  const m = s / 60;
  if (m < 60) return `${Math.round(m)}m ago`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)}h ago`;
  const d = h / 24;
  return d < 7 ? `${Math.round(d)}d ago` : new Date(ts).toLocaleDateString();
}

/** The first thing actually asked — a better handle than the file name. */
function preview(s: StoredSession): string {
  const firstUser = s.messages.find((m) => m.role === 'user' && m.text.trim());
  return firstUser ? firstUser.text.trim() : `${s.messages.length} messages`;
}

/**
 * Previously-opened papers with a saved conversation.
 *
 * Only url-backed sessions are listed: a dropped file's chat is still saved and
 * still returns when the same file is opened again, but it cannot be restored
 * from a click here — the browser can't re-read a file it was handed once.
 */
function RecentChats({ origin }: { origin: string }) {
  const [items, setItems] = useState<StoredSession[] | null>(null);

  useEffect(() => {
    let alive = true;
    listSessions(8).then((all) => alive && setItems(all.filter((s) => s.url)));
    return () => {
      alive = false;
    };
  }, []);

  const drop = async (key: string) => {
    await deleteSession(key);
    setItems((prev) => (prev ?? []).filter((s) => s.key !== key));
  };

  return (
    <section className="dd-landing-col dd-recent">
      <h2 className="dd-col-head">Recent chats</h2>
      {items === null ? (
        <p className="dd-recent-empty">…</p>
      ) : items.length === 0 ? (
        <p className="dd-recent-empty">
          Papers you've chatted about show up here, with the conversation intact.
        </p>
      ) : (
        <ul className="dd-recent-list">
          {items.map((s) => (
            <li key={s.key}>
              {/* through the address bar, so the normal resolution path runs and
                  the restored thread is keyed to the same url */}
              <a className="dd-recent-item" href={`${origin}/${s.url}`}>
                <span className="dd-recent-label">{s.label}</span>
                <span className="dd-recent-preview">{preview(s)}</span>
                <span className="dd-recent-meta">
                  {s.messages.length} message{s.messages.length === 1 ? '' : 's'} ·{' '}
                  {ago(s.updatedAt)}
                </span>
              </a>
              <button
                className="dd-recent-x"
                title="Forget this chat"
                aria-label={`Forget ${s.label}`}
                onClick={(e) => {
                  e.preventDefault();
                  void drop(s.key);
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Shown when no PDF was named in the address bar. Three ways in: drop a file,
 * pick one, or open the demo paper — plus the prefix trick, which is otherwise
 * undiscoverable.
 */
export function Landing({ onOpen }: { onOpen: (url: string, label: string) => void }) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urlDraft, setUrlDraft] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const origin = window.location.origin;
  const host = origin.replace(/^https?:\/\//, '');

  const openFile = useCallback(
    (file: File) => {
      if (file.type && file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
        setError(`${file.name} isn't a PDF.`);
        return;
      }
      onOpen(URL.createObjectURL(file), file.name.replace(/\.pdf$/i, ''));
    },
    [onOpen],
  );

  const openUrl = () => {
    const v = urlDraft.trim();
    if (!v) return;
    // Round-trip through the address bar so the link is shareable and the
    // normal resolution path (arXiv abs→pdf, proxy fallback) applies.
    window.location.href = `${origin}/${v}`;
  };

  return (
    <div
      className={`dd-landing ${dragging ? 'dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files?.[0];
        if (f) openFile(f);
      }}
    >
      <div className="dd-landing-inner">
        <header className="dd-landing-top">
          <h1 className="dd-landing-logo">
            drawde<span>.</span>
          </h1>
          <p className="dd-landing-tag">
            Read physics papers with an AI that can see the equations. Box any
            equation, and ask about it.
          </p>

          <button className="dd-drop" onClick={() => fileInput.current?.click()}>
            <span className="dd-drop-icon">↓</span>
            <b>Drop a PDF here</b>
            <em>or click to choose a file — it never leaves your device</em>
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf,.pdf"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) openFile(f);
            }}
          />

          {error && <p className="dd-landing-error">{error}</p>}

          <div className="dd-landing-or">
            <span>or paste a link</span>
          </div>

          <div className="dd-landing-urlrow">
            <input
              className="dd-landing-url"
              value={urlDraft}
              placeholder="arxiv.org/abs/2510.01051"
              onChange={(e) => setUrlDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && openUrl()}
              spellCheck={false}
            />
            <button className="dd-primary" onClick={openUrl} disabled={!urlDraft.trim()}>
              Open
            </button>
          </div>
        </header>

        <div className="dd-landing-cols">
          <RecentChats origin={origin} />

          <section className="dd-landing-col dd-suggest">
            <h2 className="dd-col-head">Any paper, from the address bar</h2>
            <div className="dd-landing-trick">
              <p>
                Put the PDF link straight after <code>{host}/</code> — each of these
                is a live link, try one:
              </p>
              <ul className="dd-landing-examples">
                {EXAMPLES.map((e) => (
                  <li key={e.path}>
                    <a href={`${origin}/${e.path}`}>
                      <span className="dd-ex-host">{host}/</span>
                      <span className="dd-ex-path">{e.path}</span>
                    </a>
                    <em>{e.note}</em>
                  </li>
                ))}
              </ul>
            </div>

            <button className="dd-linkbtn" onClick={() => onOpen(SAMPLE_PDF, 'sample paper')}>
              or open a demo paper (Maldacena, AdS/CFT) →
            </button>
          </section>
        </div>

        <p className="dd-landing-foot">
          Equation OCR runs entirely in your browser. Chat needs your own API
          key, which is sent only to the provider you choose. Conversations are
          saved on this device only.
        </p>
      </div>
    </div>
  );
}

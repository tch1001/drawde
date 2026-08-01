import { useCallback, useRef, useState } from 'react';
import { SAMPLE_PDF } from './pdf-source';

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

        <div className="dd-landing-or"><span>or paste a link</span></div>

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

        <div className="dd-landing-trick">
          <p>
            <b>Any paper, from the address bar.</b> Put the PDF link straight
            after <code>{host}/</code> — each of these is a live link, try one:
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

        <p className="dd-landing-foot">
          Equation OCR runs entirely in your browser. Chat needs your own API
          key, which is sent only to the provider you choose.
        </p>
      </div>
    </div>
  );
}

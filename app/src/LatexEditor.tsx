import { useMemo, useState } from 'react';
import katex from 'katex';

/**
 * Renders a LaTeX string, falling back to the raw source when it doesn't parse.
 *
 * OCR output is the input here, so malformed LaTeX is expected rather than
 * exceptional — it must never throw or blank the card.
 */
export function LatexPreview({ tex, display = false }: { tex: string; display?: boolean }) {
  const { html, error } = useMemo(() => {
    if (!tex.trim()) return { html: '', error: null as string | null };
    try {
      return {
        html: katex.renderToString(tex, {
          displayMode: display,
          throwOnError: true,
          output: 'html',
        }),
        error: null,
      };
    } catch (e: any) {
      return { html: '', error: String(e?.message ?? e) };
    }
  }, [tex, display]);

  if (error) {
    return (
      <div className="dd-tex-fallback" title={error}>
        {tex}
      </div>
    );
  }
  // KaTeX output only; it is generated here from the given source, not injected.
  return <div className="dd-tex" dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * Modal for correcting OCR output, with the rendered result updating as you
 * type — the point being to see whether the fix is right before committing it.
 */
export function LatexEditor({
  initial,
  cropUrl,
  onSave,
  onClose,
}: {
  initial: string;
  cropUrl?: string;
  onSave: (tex: string) => void;
  onClose: () => void;
}) {
  const [tex, setTex] = useState(initial);

  return (
    <div className="dd-modal-scrim dd-no-interaction" onPointerDown={onClose}>
      <div className="dd-modal" onPointerDown={(e) => e.stopPropagation()}>
        <header className="dd-modal-head">
          <h2>Edit LaTeX</h2>
          <button className="dd-modal-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="dd-modal-body">
          {cropUrl && (
            <>
              <span className="dd-tex-label">From the paper</span>
              <img className="dd-tex-crop" src={cropUrl} alt="selected equation" />
            </>
          )}

          <span className="dd-tex-label">Rendered</span>
          <div className="dd-tex-preview">
            <LatexPreview tex={tex} display />
          </div>

          <label className="dd-field">
            <span>LaTeX source</span>
            <textarea
              className="dd-tex-input"
              value={tex}
              onChange={(e) => setTex(e.target.value)}
              spellCheck={false}
              rows={5}
              autoFocus
            />
          </label>

          <p className="dd-note">
            The model sees the image as well as this text, so a correction here
            is a hint rather than the last word — but fixing an obviously wrong
            symbol usually helps.
          </p>
        </div>

        <footer className="dd-modal-foot">
          <button className="dd-danger" onClick={() => setTex(initial)}>
            Reset
          </button>
          <button className="dd-primary" onClick={() => onSave(tex)}>
            Save
          </button>
        </footer>
      </div>
    </div>
  );
}

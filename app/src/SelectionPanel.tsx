import { useRegions, regionStore } from './store';
import type { Region } from './types';

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
        <span className="dd-stub">→ OCR / LLM (phase 3)</span>
      </div>
    </div>
  );
}

export function SelectionPanel({
  width,
  onClose,
}: {
  width?: number;
  onClose?: () => void;
}) {
  const regions = useRegions();

  return (
    <aside className="dd-panel dd-no-interaction" style={width ? { width } : undefined}>
      <header className="dd-panel-head">
        <h2>Context</h2>
        <span className="dd-count">{regions.length}</span>
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
        {regions.length === 0 ? (
          <div className="dd-empty">
            <p>Nothing selected yet.</p>
            <ul>
              <li>
                <kbd>R</kbd> region mode → drag a box around an equation
              </li>
              <li>
                <kbd>T</kbd> text mode → drag to select text
              </li>
              <li>
                hold <kbd>Shift</kbd> while selecting to <b>add</b> instead of replace
              </li>
            </ul>
            <p className="dd-empty-note">
              Selections of both kinds collect here as <code>Region</code> objects — the
              same payload that will be piped to OCR and the LLM.
            </p>
          </div>
        ) : (
          regions.map((r, i) => <RegionCard key={r.id} region={r} index={i} />)
        )}
      </div>

      {regions.length > 0 && (
        <footer className="dd-panel-foot">
          <button className="dd-primary" disabled title="Wired up in phase 3">
            Ask drawde about {regions.length} item{regions.length > 1 ? 's' : ''}
          </button>
        </footer>
      )}
    </aside>
  );
}

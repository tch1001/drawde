import { useEffect, useRef, useState } from 'react';
import { useSearch } from '@embedpdf/plugin-search/react';

/**
 * Ctrl/Cmd+F in-document search.
 * Opens an overlay bar, searches all pages, and steps through hits with
 * Enter / Shift+Enter (or the arrows). Escape closes and clears the session.
 */
export function SearchBar({ documentId }: { documentId: string }) {
  const { provides: search, state } = useSearch(documentId);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Ctrl/Cmd+F opens (and re-focuses) the bar
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setOpen(true);
        requestAnimationFrame(() => inputRef.current?.select());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open && search) search.startSearch();
  }, [open, search]);

  const close = () => {
    setOpen(false);
    setQuery('');
    search?.stopSearch();
  };

  const run = (q: string) => {
    if (!search) return;
    const term = q.trim();
    if (!term) return;
    setBusy(true);
    const task = search.searchAllPages(term);
    task.wait(
      () => setBusy(false),
      () => setBusy(false),
    );
  };

  if (!open) return null;

  const results = state?.results ?? [];
  const active = state?.activeResultIndex ?? -1;

  return (
    <div className="dd-search dd-no-interaction">
      <input
        ref={inputRef}
        autoFocus
        value={query}
        placeholder="Find in document…"
        onChange={(e) => {
          setQuery(e.target.value);
          if (!e.target.value.trim()) return;
          run(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) search?.previousResult();
            else search?.nextResult();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            close();
          }
        }}
      />
      <span className="dd-search-count">
        {busy ? 'searching…' : results.length ? `${active + 1} / ${results.length}` : query ? 'no matches' : ''}
      </span>
      <button onClick={() => search?.previousResult()} disabled={!results.length} title="Previous (Shift+Enter)">
        ↑
      </button>
      <button onClick={() => search?.nextResult()} disabled={!results.length} title="Next (Enter)">
        ↓
      </button>
      <button onClick={close} title="Close (Esc)">
        ×
      </button>
    </div>
  );
}

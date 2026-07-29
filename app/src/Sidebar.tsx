import { useEffect, useState } from 'react';
import { useBookmarkCapability } from '@embedpdf/plugin-bookmark/react';
import { useScrollCapability } from '@embedpdf/plugin-scroll/react';
import { useRenderCapability } from '@embedpdf/plugin-render/react';
import { useDocumentState } from '@embedpdf/core/react';

interface Bookmark {
  title: string;
  target?: any;
  children?: Bookmark[];
}

/** Pull a 0-based page index out of a bookmark's link target, if it has one. */
function pageOf(bm: Bookmark): number | null {
  const t = bm.target;
  if (!t) return null;
  if (t.type === 'destination' && typeof t.destination?.pageIndex === 'number') {
    return t.destination.pageIndex;
  }
  if (t.type === 'action' && typeof t.action?.destination?.pageIndex === 'number') {
    return t.action.destination.pageIndex;
  }
  return null;
}

function OutlineTree({
  items,
  depth = 0,
  onGo,
}: {
  items: Bookmark[];
  depth?: number;
  onGo: (pageIndex: number) => void;
}) {
  const [open, setOpen] = useState<Record<number, boolean>>({});
  return (
    <ul className="dd-outline" style={{ paddingLeft: depth === 0 ? 0 : 12 }}>
      {items.map((bm, i) => {
        const page = pageOf(bm);
        const kids = bm.children ?? [];
        const isOpen = open[i] ?? depth < 1;
        return (
          <li key={i}>
            <div className="dd-outline-row">
              {kids.length > 0 ? (
                <button
                  className="dd-outline-caret"
                  onClick={() => setOpen((o) => ({ ...o, [i]: !isOpen }))}
                >
                  {isOpen ? '▾' : '▸'}
                </button>
              ) : (
                <span className="dd-outline-caret" />
              )}
              <button
                className="dd-outline-title"
                disabled={page === null}
                onClick={() => page !== null && onGo(page)}
                title={bm.title}
              >
                {bm.title}
              </button>
              {page !== null && <span className="dd-outline-page">{page + 1}</span>}
            </div>
            {kids.length > 0 && isOpen && (
              <OutlineTree items={kids} depth={depth + 1} onGo={onGo} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function PageThumb({
  documentId,
  pageIndex,
  active,
  onGo,
}: {
  documentId: string;
  pageIndex: number;
  active: boolean;
  onGo: (p: number) => void;
}) {
  const { provides: render } = useRenderCapability();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!render) return;
    let dead = false;
    let made: string | null = null;
    const task = render
      .forDocument(documentId)
      .renderPage({ pageIndex, options: { scaleFactor: 0.22 } });
    task.wait(
      (blob: Blob) => {
        if (dead) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      },
      () => {},
    );
    return () => {
      dead = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [render, documentId, pageIndex]);

  return (
    <button
      className={`dd-thumb ${active ? 'on' : ''}`}
      onClick={() => onGo(pageIndex)}
      title={`Page ${pageIndex + 1}`}
    >
      <div className="dd-thumb-img">
        {url ? <img src={url} alt={`page ${pageIndex + 1}`} /> : <div className="dd-thumb-skel" />}
      </div>
      <span>{pageIndex + 1}</span>
    </button>
  );
}

export function Sidebar({
  documentId,
  open,
  width,
  currentPage,
}: {
  documentId: string;
  open: boolean;
  width: number;
  currentPage: number;
}) {
  const { provides: bookmarks } = useBookmarkCapability();
  const { provides: scroll } = useScrollCapability();
  const documentState = useDocumentState(documentId);
  const pageCount = documentState?.document?.pageCount ?? documentState?.document?.pages?.length ?? 0;

  const [outline, setOutline] = useState<Bookmark[] | null>(null);
  const [tab, setTab] = useState<'outline' | 'pages'>('pages');
  const [checkedOutline, setCheckedOutline] = useState(false);

  useEffect(() => {
    if (!bookmarks || checkedOutline) return;
    const task = bookmarks.forDocument(documentId).getBookmarks();
    task.wait(
      (res: { bookmarks: Bookmark[] }) => {
        const list = res?.bookmarks ?? [];
        setOutline(list);
        setCheckedOutline(true);
        // if the paper actually has chapters, show them by default
        if (list.length > 0) setTab('outline');
      },
      () => {
        setOutline([]);
        setCheckedOutline(true);
      },
    );
  }, [bookmarks, documentId, checkedOutline]);

  const go = (pageIndex: number) =>
    scroll?.forDocument(documentId).scrollToPage({ pageNumber: pageIndex + 1, behavior: 'auto' });

  if (!open) return null;

  const hasOutline = (outline?.length ?? 0) > 0;

  return (
    <aside className="dd-sidebar dd-no-interaction" style={{ width }}>
      <div className="dd-sidebar-tabs">
        <button
          className={tab === 'outline' ? 'on' : ''}
          onClick={() => setTab('outline')}
          disabled={!hasOutline}
          title={hasOutline ? 'Document outline' : 'This PDF has no embedded outline'}
        >
          Chapters
        </button>
        <button className={tab === 'pages' ? 'on' : ''} onClick={() => setTab('pages')}>
          Pages
        </button>
      </div>

      <div className="dd-sidebar-body">
        {tab === 'outline' ? (
          hasOutline ? (
            <OutlineTree items={outline!} onGo={go} />
          ) : (
            <p className="dd-sidebar-empty">
              {checkedOutline ? 'This PDF has no embedded outline.' : 'reading outline…'}
            </p>
          )
        ) : (
          <div className="dd-thumbs">
            {Array.from({ length: pageCount }, (_, i) => (
              <PageThumb
                key={i}
                documentId={documentId}
                pageIndex={i}
                active={i === currentPage}
                onGo={go}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

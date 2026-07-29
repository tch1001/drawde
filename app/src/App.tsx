import { useEffect, useRef, useState } from 'react';
import { createPluginRegistration } from '@embedpdf/core';
import { EmbedPDF } from '@embedpdf/core/react';
import { usePdfiumEngine } from '@embedpdf/engines/react';
import { Viewport, ViewportPluginPackage } from '@embedpdf/plugin-viewport/react';
import { Scroller, ScrollPluginPackage } from '@embedpdf/plugin-scroll/react';
import {
  DocumentContent,
  DocumentManagerPluginPackage,
} from '@embedpdf/plugin-document-manager/react';
import { RenderLayer, RenderPluginPackage } from '@embedpdf/plugin-render/react';
import {
  InteractionManagerPluginPackage,
  PagePointerProvider,
  useInteractionManagerCapability,
} from '@embedpdf/plugin-interaction-manager/react';
import {
  SelectionLayer,
  SelectionPluginPackage,
  useSelectionCapability,
} from '@embedpdf/plugin-selection/react';
import { ZoomPluginPackage, useZoom, useZoomCapability } from '@embedpdf/plugin-zoom/react';
import { BookmarkPluginPackage } from '@embedpdf/plugin-bookmark/react';
import { useScrollCapability, useScroll } from '@embedpdf/plugin-scroll/react';

import { BoxSelectLayer } from './BoxSelectLayer';
import { SelectionPanel } from './SelectionPanel';
import { Sidebar } from './Sidebar';
import { BOX_MODE, TEXT_MODE } from './modes';
import { nextRegionId, regionStore } from './store';
import type { Region } from './types';

const PDF_URL = './sample.pdf';

const plugins = [
  createPluginRegistration(DocumentManagerPluginPackage, {
    initialDocuments: [{ url: PDF_URL, documentId: 'paper' }],
  }),
  createPluginRegistration(ViewportPluginPackage),
  createPluginRegistration(ScrollPluginPackage),
  createPluginRegistration(RenderPluginPackage),
  createPluginRegistration(InteractionManagerPluginPackage),
  createPluginRegistration(SelectionPluginPackage),
  // NB: do NOT pass a partial config here — it replaces the plugin's whole defaultConfig,
  // wiping zoomRanges/minZoom/maxZoom, and scroll layout then never emits (blank viewer).
  createPluginRegistration(ZoomPluginPackage),
  createPluginRegistration(BookmarkPluginPackage),
];

/**
 * Instant page navigation.
 *
 * PageUp/PageDown must respond to every keypress, including rapid repeats. The naive
 * approach (scrollToNextPage) reads the *current* page, which lags behind during a
 * scroll animation, so a fast double-press moves only one page. We keep our own target
 * counter and jump with behavior:'auto' so presses never get swallowed.
 */
function KeyboardNav({ documentId, pageCount }: { documentId: string; pageCount: number }) {
  const { provides: scroll } = useScrollCapability();
  const targetRef = useRef<number | null>(null);
  const idleTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!scroll) return;
    const scoped = scroll.forDocument(documentId);

    const jump = (delta: number | 'first' | 'last') => {
      const current = targetRef.current ?? scoped.getCurrentPage();
      let next: number;
      if (delta === 'first') next = 1;
      else if (delta === 'last') next = pageCount;
      else next = current + delta;
      next = Math.max(1, Math.min(pageCount || 1, next));
      targetRef.current = next;
      scoped.scrollToPage({ pageNumber: next, behavior: 'auto' });

      // let the target fall back to reality once the user stops pressing
      window.clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(() => {
        targetRef.current = null;
      }, 400);
    };

    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA)$/.test(t.tagName)) return;
      switch (e.key) {
        case 'PageDown':
          e.preventDefault();
          jump(1);
          break;
        case 'PageUp':
          e.preventDefault();
          jump(-1);
          break;
        case 'Home':
          if (e.ctrlKey || e.metaKey) { e.preventDefault(); jump('first'); }
          break;
        case 'End':
          if (e.ctrlKey || e.metaKey) { e.preventDefault(); jump('last'); }
          break;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(idleTimer.current);
    };
  }, [scroll, documentId, pageCount]);

  return null;
}

/** Registers drawde's box mode and binds R / T. */
function ModeController({
  documentId,
  sidebarOpen,
  onToggleSidebar,
}: {
  documentId: string;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}) {
  const { provides: interaction } = useInteractionManagerCapability();
  const [mode, setMode] = useState<string>(TEXT_MODE);

  useEffect(() => {
    if (!interaction) return;
    interaction.registerMode({
      id: BOX_MODE,
      scope: 'page',
      exclusive: false,
      cursor: 'crosshair',
    });
    // keep our own chrome from swallowing page pointer events
    interaction.addExclusionClass('dd-no-interaction');
    return interaction.onModeChange((s: { activeMode: string }) => setMode(s.activeMode));
  }, [interaction]);

  useEffect(() => {
    if (!interaction) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA)$/.test(t.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'r') {
        e.preventDefault();
        interaction.activate(BOX_MODE);
      } else if (k === 't') {
        e.preventDefault();
        interaction.activate(TEXT_MODE);
      } else if (k === 'escape') {
        regionStore.clear();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [interaction]);

  const isBox = mode === BOX_MODE;

  return (
    <div className="dd-modebar dd-no-interaction">
      <button
        className={`dd-burger ${sidebarOpen ? 'on' : ''}`}
        onClick={onToggleSidebar}
        title="Chapters & pages"
        aria-label="Toggle sidebar"
      >
        ☰
      </button>
      <button
        className={`dd-mode ${isBox ? 'on' : ''}`}
        onClick={() => interaction?.activate(BOX_MODE)}
      >
        ▭ Region <kbd>R</kbd>
      </button>
      <button
        className={`dd-mode ${!isBox ? 'on' : ''}`}
        onClick={() => interaction?.activate(TEXT_MODE)}
      >
        T Text <kbd>T</kbd>
      </button>
      <span className="dd-hint">
        {isBox ? 'drag a box around an equation' : 'drag to select text'} ·{' '}
        <kbd>Shift</kbd> add · <kbd>Ctrl</kbd>+scroll zoom · <kbd>PgUp</kbd>/<kbd>PgDn</kbd> page
      </span>
      <ZoomControls documentId={documentId} />
      <PageIndicator documentId={documentId} />
    </div>
  );
}

function ZoomControls({ documentId }: { documentId: string }) {
  const { provides: zoom, state } = useZoom(documentId);
  const pct = Math.round((state?.currentZoomLevel ?? 1) * 100);

  // anchor button zooms on the middle of the visible area so the reader keeps their place
  const viewportCenter = () => {
    const el = document.querySelector<HTMLElement>('.dd-viewport');
    if (!el) return undefined;
    const r = el.getBoundingClientRect();
    return { vx: r.width / 2, vy: r.height / 2 };
  };
  const by = (d: number) => zoom?.forDocument(documentId).requestZoomBy(d, viewportCenter());

  return (
    <span className="dd-zoom">
      <button onClick={() => by(-0.1)} title="Zoom out">−</button>
      <span>{Number.isFinite(pct) ? pct : 100}%</span>
      <button onClick={() => by(0.1)} title="Zoom in">+</button>
    </span>
  );
}

function PageIndicator({ documentId }: { documentId: string }) {
  const { state } = useScroll(documentId);
  if (!state?.totalPages) return null;
  return (
    <span className="dd-pageind">
      p. {state.currentPage} / {state.totalPages}
    </span>
  );
}

/**
 * Bridges EmbedPDF's text selection into the same Region store the box layer writes to.
 * Text and box selections become the same kind of object — see docs/architecture-notes.md.
 */
function TextSelectionBridge({ documentId }: { documentId: string }) {
  const { provides: selection } = useSelectionCapability();

  useEffect(() => {
    if (!selection) return;
    const scoped = selection.forDocument(documentId);

    return scoped.onEndSelection(() => {
      const formatted = scoped.getFormattedSelection();
      if (!formatted || formatted.length === 0) return;

      scoped.getSelectedText().wait(
        (lines: string[]) => {
          const text = lines.join('\n').trim();
          if (!text) return;

          // one Region per contiguous page-run of the selection
          const first = formatted[0];
          const region: Region = {
            id: nextRegionId(),
            kind: 'text',
            pageIndex: first.pageIndex,
            rect: first.rect,
            subRects: formatted.flatMap((f: any) => f.segmentRects ?? []),
            text,
            createdAt: Date.now(),
          };

          // shift-select adds; plain select replaces
          if (shiftHeld) regionStore.add(region);
          else regionStore.replace(region);

          scoped.clear();
        },
        () => {},
      );
    });
  }, [selection, documentId]);

  return null;
}

// module-level shift tracking: pointerup fires after keyup in some browsers,
// so we sample the modifier continuously rather than off the event.
let shiftHeld = false;
window.addEventListener('keydown', (e) => {
  if (e.key === 'Shift') shiftHeld = true;
});
window.addEventListener('keyup', (e) => {
  if (e.key === 'Shift') shiftHeld = false;
});
window.addEventListener('pointerdown', (e) => {
  shiftHeld = e.shiftKey || e.metaKey || e.ctrlKey;
}, true);

/**
 * Ctrl/Cmd + wheel to zoom, centred on the cursor.
 *
 * Done by hand rather than with EmbedPDF's ZoomGestureWrapper: that component renders
 * nothing in this composition (it silently swallowed the whole Viewport subtree), and a
 * plain wheel listener gives us the cursor-centred behaviour with no layout risk.
 * Must be non-passive so preventDefault() can stop the browser's page zoom.
 */
function CtrlWheelZoom({ documentId }: { documentId: string }) {
  const { provides: zoom } = useZoomCapability();

  useEffect(() => {
    if (!zoom) return;
    const el = document.querySelector<HTMLElement>('.dd-viewport');
    if (!el) return;
    const scoped = zoom.forDocument(documentId);

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      // NB: the zoom plugin's Point is {vx, vy}, NOT {x, y}. Passing x/y leaves vx/vy
      // undefined, the scroll-preservation math goes NaN, and the viewer jumps to page 1.
      const center = { vx: e.clientX - r.left, vy: e.clientY - r.top };
      // trackpads report fine-grained deltas; clamp so one notch is a sane step
      const step = Math.max(-0.25, Math.min(0.25, -e.deltaY * 0.003));
      scoped.requestZoomBy(step, center);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoom, documentId]);

  return null;
}

/** Draggable splitter. `side` says which edge of the flex row it belongs to. */
function Splitter({
  onDrag,
  side,
}: {
  onDrag: (deltaPx: number) => void;
  side: 'left' | 'right';
}) {
  const dragging = useRef(false);
  const lastX = useRef(0);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!dragging.current) return;
      const dx = e.clientX - lastX.current;
      lastX.current = e.clientX;
      onDrag(side === 'left' ? dx : -dx);
    };
    const up = () => {
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [onDrag, side]);

  return (
    <div
      className="dd-splitter dd-no-interaction"
      onPointerDown={(e) => {
        dragging.current = true;
        lastX.current = e.clientX;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
      }}
    />
  );
}

/** Supplies page count / current page from scroll state to the nav + sidebar. */
function NavHost({ documentId }: { documentId: string }) {
  const { state } = useScroll(documentId);
  return <KeyboardNav documentId={documentId} pageCount={state?.totalPages ?? 0} />;
}

function SidebarHost({
  documentId,
  open,
  width,
}: {
  documentId: string;
  open: boolean;
  width: number;
}) {
  const { state } = useScroll(documentId);
  return (
    <Sidebar
      documentId={documentId}
      open={open}
      width={width}
      currentPage={(state?.currentPage ?? 1) - 1}
    />
  );
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export default function App() {
  const { engine, isLoading } = usePdfiumEngine();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarW, setSidebarW] = useState(190);
  const [panelW, setPanelW] = useState(360);

  if (isLoading || !engine) {
    return (
      <div className="dd-boot">
        <div className="dd-spinner" />
        <span>loading PDFium engine…</span>
      </div>
    );
  }

  return (
    <EmbedPDF engine={engine} plugins={plugins}>
      {({ activeDocumentId }: { activeDocumentId: string | null }) =>
        activeDocumentId && (
          <DocumentContent documentId={activeDocumentId}>
            {({ isLoaded }: { isLoaded: boolean }) =>
              isLoaded ? (
                <div className="dd-app">
                  <header className="dd-top dd-no-interaction">
                    <h1>
                      drawde <span>viewer</span>
                    </h1>
                    <ModeController
                      documentId={activeDocumentId}
                      sidebarOpen={sidebarOpen}
                      onToggleSidebar={() => setSidebarOpen((v) => !v)}
                    />
                  </header>

                  <main className="dd-main">
                    <SidebarHost
                      documentId={activeDocumentId}
                      open={sidebarOpen}
                      width={sidebarW}
                    />
                    {sidebarOpen && (
                      <Splitter
                        side="left"
                        onDrag={(dx) => setSidebarW((w) => clamp(w + dx, 130, 460))}
                      />
                    )}

                    <div className="dd-viewer">
                      <Viewport documentId={activeDocumentId} className="dd-viewport">
                        <Scroller
                          documentId={activeDocumentId}
                          renderPage={({ pageIndex }: { pageIndex: number }) => (
                            <PagePointerProvider
                              documentId={activeDocumentId}
                              pageIndex={pageIndex}
                              // A real mouse drag over the page would otherwise start the
                              // browser's native image drag / text selection, which fires
                              // dragstart and CANCELS the pointer stream — killing both box
                              // drawing and text selection. Synthetic events never hit this.
                              onDragStart={(e) => e.preventDefault()}
                              style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
                            >
                              <RenderLayer
                                documentId={activeDocumentId}
                                pageIndex={pageIndex}
                                draggable={false}
                                style={{ WebkitUserDrag: 'none', userSelect: 'none' } as any}
                              />
                              <SelectionLayer
                                documentId={activeDocumentId}
                                pageIndex={pageIndex}
                              />
                              <BoxSelectLayer
                                documentId={activeDocumentId}
                                pageIndex={pageIndex}
                              />
                            </PagePointerProvider>
                          )}
                        />
                      </Viewport>
                      <TextSelectionBridge documentId={activeDocumentId} />
                      <NavHost documentId={activeDocumentId} />
                      <CtrlWheelZoom documentId={activeDocumentId} />
                    </div>

                    <Splitter
                      side="right"
                      onDrag={(dx) => setPanelW((w) => clamp(w + dx, 240, 720))}
                    />
                    <SelectionPanel width={panelW} />
                  </main>
                </div>
              ) : (
                <div className="dd-boot">
                  <div className="dd-spinner" />
                  <span>loading document…</span>
                </div>
              )
            }
          </DocumentContent>
        )
      }
    </EmbedPDF>
  );
}

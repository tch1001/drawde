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
import { TilingLayer, TilingPluginPackage } from '@embedpdf/plugin-tiling/react';
import { SearchLayer, SearchPluginPackage } from '@embedpdf/plugin-search/react';

import { BoxSelectLayer } from './BoxSelectLayer';
import { SelectionPanel } from './SelectionPanel';
import { Sidebar } from './Sidebar';
import { SearchBar } from './SearchBar';
import { PanPluginPackage, usePan } from '@embedpdf/plugin-pan/react';
import { selectionMode, useSelectionMode } from './selection-mode';
import { PAN_MODE } from './modes';
import { BOX_MODE, TEXT_MODE } from './modes';
import { nextRegionId, regionStore, useRegions } from './store';
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
  // tiling keeps the previous render on screen while high-res tiles refine on top,
  // which is what removes the flash when zooming
  createPluginRegistration(TilingPluginPackage, { tileSize: 768, overlapPx: 2, extraRings: 1 }),
  createPluginRegistration(SearchPluginPackage),
  // defaultMode 'mobile' is the plugin default: pan is the default tool on touch
  // devices, so a phone scrolls/pinches naturally until a select tool is chosen.
  createPluginRegistration(PanPluginPackage),
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
      } else if (k === 'h') {
        e.preventDefault();
        interaction.activate(PAN_MODE);
      } else if (k === 'l') {
        e.preventDefault();
        selectionMode.toggleLock();
      } else if (k === 'escape') {
        regionStore.clear();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [interaction]);

  const tool =
    mode === BOX_MODE ? 'box' : mode === PAN_MODE ? 'pan' : 'text';

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

      <div className="dd-tools">
        <button
          className={`dd-mode ${tool === 'pan' ? 'on' : ''}`}
          onClick={() => interaction?.activate(PAN_MODE)}
          title="Pan & zoom (H)"
        >
          <span className="dd-ico">✋</span>
          <span className="dd-lbl">Pan <kbd>H</kbd></span>
        </button>
        <button
          className={`dd-mode ${tool === 'box' ? 'on' : ''}`}
          onClick={() => interaction?.activate(BOX_MODE)}
          title="Select a region (R)"
        >
          <span className="dd-ico">▭</span>
          <span className="dd-lbl">Region <kbd>R</kbd></span>
        </button>
        <button
          className={`dd-mode ${tool === 'text' ? 'on' : ''}`}
          onClick={() => interaction?.activate(TEXT_MODE)}
          title="Select text (T)"
        >
          <span className="dd-ico">T</span>
          <span className="dd-lbl">Text <kbd>T</kbd></span>
        </button>
        <LockSelectionButton />
      </div>

      <span className="dd-hint">
        {tool === 'box'
          ? 'drag a box around an equation'
          : tool === 'text'
            ? 'drag to select text'
            : 'drag to pan · pinch or ctrl+scroll to zoom'}
      </span>

      {/* On mobile this becomes a floating pill at the bottom — the top row
          has no space for it next to the tools and the chat button. */}
      <div className="dd-meta">
        <ZoomControls documentId={documentId} />
        <PageIndicator documentId={documentId} />
      </div>
    </div>
  );
}

/**
 * Additive-selection toggle. Tapping it locks additive mode on (the only way to
 * multi-select on touch); holding Shift lights up the same button, so the
 * keyboard shortcut and the touch affordance are visibly one feature.
 */
function LockSelectionButton() {
  const { locked, shift, isAdditive } = useSelectionMode();
  return (
    <button
      className={`dd-mode dd-lock ${isAdditive ? 'on' : ''} ${shift && !locked ? 'via-shift' : ''}`}
      onClick={() => selectionMode.toggleLock()}
      title={
        locked
          ? 'Selection locked — new selections add to the context (L). Tap to unlock.'
          : 'Lock selection so new selections add instead of replacing. Holding Shift does the same (L).'
      }
      aria-pressed={locked}
    >
      <span className="dd-ico">{isAdditive ? '🔒' : '🔓'}</span>
      <span className="dd-lbl">
        {shift && !locked ? 'Adding' : locked ? 'Locked' : 'Lock'} <kbd>L</kbd>
      </span>
    </button>
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
  // useZoom(documentId).provides is ALREADY document-scoped — no .forDocument() on it.
  const by = (d: number) => zoom?.requestZoomBy(d, viewportCenter());

  return (
    <span className="dd-zoom">
      <button onClick={() => by(-0.1)} title="Zoom out">−</button>
      <span>{Number.isFinite(pct) ? pct : 100}%</span>
      <button onClick={() => by(0.1)} title="Zoom in">+</button>
    </span>
  );
}

/** Editable page number — type a page and press Enter to jump there. */
function PageIndicator({ documentId }: { documentId: string }) {
  const { state, provides: scroll } = useScroll(documentId);
  const [draft, setDraft] = useState<string | null>(null);

  if (!state?.totalPages) return null;
  const total = state.totalPages;

  const commit = () => {
    const n = parseInt(draft ?? '', 10);
    setDraft(null);
    if (!Number.isFinite(n)) return;
    scroll?.scrollToPage({
      pageNumber: Math.max(1, Math.min(total, n)),
      behavior: 'auto',
    });
  };

  return (
    <span className="dd-pageind">
      p.
      <input
        className="dd-pageinput"
        value={draft ?? String(state.currentPage)}
        onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
        onFocus={(e) => {
          setDraft(String(state.currentPage));
          requestAnimationFrame(() => e.target.select());
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            setDraft(null);
            (e.target as HTMLInputElement).blur();
          }
        }}
        title="Type a page number and press Enter"
      />
      / {total}
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

          // additive (shift held or selection-lock on) adds; otherwise replaces
          if (selectionMode.isAdditive) regionStore.add(region);
          else regionStore.replace(region);

          scoped.clear();
        },
        () => {},
      );
    });
  }, [selection, documentId]);

  return null;
}

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
  width?: number;
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

const MOBILE_QUERY = '(max-width: 820px)';

/** True on narrow viewports. Drives single-pane layout + overlay panels. */
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return isMobile;
}

/** Count badge on the mobile chat button so selections aren't invisible. */
function ChatButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const regions = useRegions();
  return (
    <button
      className={`dd-chatbtn ${open ? 'on' : ''}`}
      onClick={onToggle}
      title="Context & chat"
      aria-label="Toggle context panel"
    >
      💬
      {regions.length > 0 && <span className="dd-chatbtn-badge">{regions.length}</span>}
    </button>
  );
}

export default function App() {
  const { engine, isLoading } = usePdfiumEngine();
  const isMobile = useIsMobile();
  // Desktop starts with both panes open; mobile starts on the PDF alone.
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile);
  const [panelOpen, setPanelOpen] = useState(!isMobile);
  const [sidebarW, setSidebarW] = useState(190);
  const [panelW, setPanelW] = useState(360);

  // Crossing the breakpoint resets to that layout's sensible default, and
  // guarantees we never leave a mobile overlay stuck open on desktop.
  useEffect(() => {
    setSidebarOpen(!isMobile);
    setPanelOpen(!isMobile);
  }, [isMobile]);

  // On mobile the panels are overlays, so only one may be open at a time.
  const openSidebar = (v: boolean) => {
    setSidebarOpen(v);
    if (v && isMobile) setPanelOpen(false);
  };
  const openPanel = (v: boolean) => {
    setPanelOpen(v);
    if (v && isMobile) setSidebarOpen(false);
  };

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
                <div className={`dd-app ${isMobile ? 'is-mobile' : ''}`}>
                  <header className="dd-top dd-no-interaction">
                    {/* logo is desktop-only — the phone needs the width for tools */}
                    <h1 className="dd-logo">
                      drawde <span>viewer</span>
                    </h1>
                    <ModeController
                      documentId={activeDocumentId}
                      sidebarOpen={sidebarOpen}
                      onToggleSidebar={() => openSidebar(!sidebarOpen)}
                    />
                    <ChatButton open={panelOpen} onToggle={() => openPanel(!panelOpen)} />
                  </header>

                  <main className="dd-main">
                    {/* one tap anywhere on the PDF dismisses an open overlay */}
                    {isMobile && (sidebarOpen || panelOpen) && (
                      <div
                        className="dd-scrim dd-no-interaction"
                        onPointerDown={() => {
                          setSidebarOpen(false);
                          setPanelOpen(false);
                        }}
                      />
                    )}

                    <SidebarHost
                      documentId={activeDocumentId}
                      open={sidebarOpen}
                      width={isMobile ? undefined : sidebarW}
                    />
                    {sidebarOpen && !isMobile && (
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
                              {/* base render pinned at scale 1: it does NOT re-render on
                                  zoom, so there is no blank flash — the tiling layer
                                  paints crisp tiles over it at the live scale. */}
                              <RenderLayer
                                documentId={activeDocumentId}
                                pageIndex={pageIndex}
                                scale={1}
                                draggable={false}
                                style={{ WebkitUserDrag: 'none', userSelect: 'none' } as any}
                              />
                              <TilingLayer
                                documentId={activeDocumentId}
                                pageIndex={pageIndex}
                                style={{ WebkitUserDrag: 'none', userSelect: 'none' } as any}
                              />
                              <SearchLayer
                                documentId={activeDocumentId}
                                pageIndex={pageIndex}
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
                      <SearchBar documentId={activeDocumentId} />
                    </div>

                    {panelOpen && !isMobile && (
                      <Splitter
                        side="right"
                        onDrag={(dx) => setPanelW((w) => clamp(w + dx, 240, 720))}
                      />
                    )}
                    {panelOpen && (
                      <SelectionPanel
                        width={isMobile ? undefined : panelW}
                        onClose={isMobile ? () => setPanelOpen(false) : undefined}
                      />
                    )}
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

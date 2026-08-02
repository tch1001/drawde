import { useEffect, useMemo, useRef, useState } from 'react';
import { createPluginRegistration } from '@embedpdf/core';
import { EmbedPDF } from '@embedpdf/core/react';
import { useDocumentState } from '@embedpdf/core/react';
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
import { ZoomPluginPackage, useZoom, useZoomCapability, ZoomGestureWrapper } from '@embedpdf/plugin-zoom/react';
import { BookmarkPluginPackage } from '@embedpdf/plugin-bookmark/react';
import { useScrollCapability, useScroll } from '@embedpdf/plugin-scroll/react';
import { TilingLayer, TilingPluginPackage } from '@embedpdf/plugin-tiling/react';
import { SearchLayer, SearchPluginPackage } from '@embedpdf/plugin-search/react';

import { BoxSelectLayer } from './BoxSelectLayer';
import { SelectionPanel } from './SelectionPanel';
import { Sidebar } from './Sidebar';
import { SearchBar } from './SearchBar';
import { Settings } from './Settings';
import { PanPluginPackage } from '@embedpdf/plugin-pan/react';
import { selectionMode, useSelectionMode } from './selection-mode';
import { PAN_MODE } from './modes';
import { BOX_MODE, TEXT_MODE } from './modes';
import { nextRegionId, regionStore, useRegions } from './store';
import { chatStore } from './chat';
import { documentKey } from './persist';
import type { Region } from './types';
import { resolvePdfSource, fetchPdf } from './pdf-source';
import { Landing } from './Landing';

/**
 * Plugin list. Built per document because the PDF URL comes from the address
 * bar (drawde.example/https://arxiv.org/pdf/...), not a constant.
 */
const buildPlugins = (pdfUrl: string) => [
  createPluginRegistration(DocumentManagerPluginPackage, {
    initialDocuments: [{ url: pdfUrl, documentId: 'paper' }],
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
  // Tiling keeps the previous render on screen while high-res tiles refine on
  // top. extraRings stays at 0 (the package default): pre-rendering a ring of
  // off-screen tiles multiplies bitmap memory, and iOS Safari kills the tab
  // rather than degrading when it runs out.
  createPluginRegistration(TilingPluginPackage, { tileSize: 768, overlapPx: 2.5, extraRings: 0 }),
  createPluginRegistration(SearchPluginPackage),
  // 'never' overrides the package default of 'mobile': pan must not claim the
  // default tool on touch — Region is the default everywhere (see
  // ModeController). Pan is one tap away. Safe to pass partially: defaultMode
  // is this config's only field, unlike the zoom plugin above.
  createPluginRegistration(PanPluginPackage, { defaultMode: 'never' }),
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
  const [mode, setMode] = useState<string>(BOX_MODE);
  const isMobile = useIsMobile();
  // Desktop already pans with the scroll wheel, so the hand tool is noise there.
  // On touch, dragging out a text selection is fiddly and Region is the point.
  const showPan = isMobile;
  const showText = !isMobile;

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

    // Region is the default *selection* tool — never Text — on both platforms.
    //
    // On touch, though, it must not be the default tool outright: a mode that
    // draws by dragging has to claim raw touch, and the interaction manager
    // implements that by putting `touch-action: none` on every page. That
    // disables the browser's native compositor scrolling over the whole PDF,
    // so every scroll round-trips through JS and feels laggy. One finger can
    // scroll or draw, not both. So touch opens in Pan (smooth native-feeling
    // scrolling) with Region one tap away; desktop opens straight in Region,
    // where the wheel scrolls and the drag is free to draw.
    const initial = isMobile ? PAN_MODE : BOX_MODE;
    // Subscribe BEFORE activating: activate() emits synchronously, so
    // subscribing afterwards misses the very event that tells the toolbar which
    // tool is live — the mode would be right but the button would look wrong.
    const unsubscribe = interaction.onModeChange((s: { activeMode: string }) =>
      setMode(s.activeMode),
    );
    interaction.setDefaultMode(initial);
    interaction.activate(initial);
    setMode(initial);
    return unsubscribe;
  }, [interaction, isMobile]);

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

  // Crossing the breakpoint can strand you in a tool whose button just
  // disappeared (text on mobile, pan on desktop) — fall back to Region.
  useEffect(() => {
    if (!interaction) return;
    const stranded =
      (isMobile && mode === TEXT_MODE) || (!isMobile && mode === PAN_MODE);
    if (stranded) interaction.activate(BOX_MODE);
  }, [interaction, isMobile, mode]);

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
        {showPan && (
          <button
            className={`dd-mode ${tool === 'pan' ? 'on' : ''}`}
            onClick={() => interaction?.activate(PAN_MODE)}
            title="Pan & zoom (H)"
          >
            <span className="dd-ico">✋</span>
            <span className="dd-lbl">Pan <kbd>H</kbd></span>
          </button>
        )}
        <button
          className={`dd-mode ${tool === 'box' ? 'on' : ''}`}
          onClick={() => interaction?.activate(BOX_MODE)}
          title="Select a region (R)"
        >
          <span className="dd-ico">▭</span>
          <span className="dd-lbl">Region <kbd>R</kbd></span>
        </button>
        {showText && (
          <button
            className={`dd-mode ${tool === 'text' ? 'on' : ''}`}
            onClick={() => interaction?.activate(TEXT_MODE)}
            title="Select text (T)"
          >
            <span className="dd-ico">T</span>
            <span className="dd-lbl">Text <kbd>T</kbd></span>
          </button>
        )}
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

      // Latch additive NOW, synchronously at end-of-selection. Text extraction
      // below is async, and reading the flag inside its callback loses the race
      // against a user who releases Shift as they release the mouse — their
      // additive selection would silently replace the context instead.
      // BoxSelectLayer latches at pointerdown for the same reason.
      const additive = selectionMode.isAdditive;

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
          if (additive) regionStore.add(region);
          else regionStore.replace(region);

          scoped.clear();
        },
        () => {},
      );
    });
  }, [selection, documentId]);

  return null;
}

/*
 * Zoom gesture split:
 *   - PINCH  → EmbedPDF's <ZoomGestureWrapper> (smooth CSS-transform preview)
 *   - WHEEL  → CtrlWheelZoom below, because the wrapper's wheel sensitivity is
 *              not configurable and is far too hot for a mouse.
 *
 * Background: applying zoom on every wheel event is what produced the visible
 * "screen moves twice" — each requestZoomBy re-renders pages at the new scale on
 * one frame and corrects scroll on the *next*, and a trackpad fires that dozens
 * of times per gesture. So this handler accumulates deltas and commits ONCE when
 * the gesture goes quiet, giving a single clean move.
 *
 * The wrapper's own wheel path is disabled (enableWheel={false}). Its factor is
 * `1 - deltaY * 0.01`, which turns one mouse notch (deltaY ~120) into a 2.2x
 * jump; WHEEL_SENSITIVITY below is ~8x gentler.
 */
const WHEEL_SENSITIVITY = 0.0012;
const WHEEL_COMMIT_MS = 90;

function CtrlWheelZoom({ documentId }: { documentId: string }) {
  const { provides: zoom } = useZoomCapability();

  useEffect(() => {
    if (!zoom) return;
    const el = document.querySelector<HTMLElement>('.dd-viewport');
    if (!el) return;
    const scoped = zoom.forDocument(documentId);

    let accumulated = 0;
    let center: { vx: number; vy: number } | undefined;
    let timer: number | undefined;

    const commit = () => {
      timer = undefined;
      const step = Math.max(-0.6, Math.min(0.6, accumulated));
      accumulated = 0;
      if (step) scoped.requestZoomBy(step, center);
    };

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      // must be non-passive, or the browser zooms the whole page as well
      e.preventDefault();
      const r = el.getBoundingClientRect();
      // NB: the zoom plugin's Point is {vx, vy}, NOT {x, y}. Passing x/y leaves
      // vx/vy undefined, the scroll math goes NaN, and the viewer jumps to page 1.
      center = { vx: e.clientX - r.left, vy: e.clientY - r.top };
      accumulated += -e.deltaY * WHEEL_SENSITIVITY;
      window.clearTimeout(timer);
      timer = window.setTimeout(commit, WHEEL_COMMIT_MS);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      window.clearTimeout(timer);
    };
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

/**
 * Scale for the base RenderLayer, quantized to a coarse ladder.
 *
 * Why not just use the live zoom: RenderLayer re-renders on every scale change,
 * so tracking zoom exactly would thrash the renderer during a pinch.
 * Why not pin it at 1: then at 300% the base is a 3x upscale, and since the
 * tiling layer briefly has no tiles mid-zoom you see a soft-to-sharp pulse.
 *
 * Quantizing gets both: the base is never worse than a ~1.4x upscale, and it
 * only re-renders when you cross a rung. RenderLayer keeps the previous image
 * on screen while the new one decodes, so crossing a rung never blanks.
 * Capped at 2 deliberately — a scale-4 base on a letter page is ~31 MB of
 * bitmap per page, which is a bad trade on phones when tiles cover detail.
 */
const BASE_SCALE_LADDER = [1, 1.5, 2];

/**
 * Rendered pixels = pageSize x baseScale x dpr, and that product is a hard
 * ceiling on iOS Safari, which kills the tab rather than failing the draw.
 * A letter page at baseScale 2 on a dpr-3 phone is 3672x4752 = 17.4M px,
 * past Safari's per-canvas limit — which is what made zooming past 100%
 * crash there. Budget the PRODUCT, not either factor alone.
 */
const MAX_RENDER_DPR = 2;
const MAX_BASE_PIXEL_SCALE = 2;

export function renderDpr() {
  return Math.min(window.devicePixelRatio || 1, MAX_RENDER_DPR);
}

function useBaseScale(documentId: string) {
  const documentState = useDocumentState(documentId);
  const scale = documentState?.scale ?? 1;
  const rung =
    BASE_SCALE_LADDER.find((r) => r >= scale) ??
    BASE_SCALE_LADDER[BASE_SCALE_LADDER.length - 1];
  // On a retina screen the dpr already supplies the detail, so the ladder
  // collapses to 1 and the tiling layer covers sharpness at high zoom.
  return Math.max(1, Math.min(rung, MAX_BASE_PIXEL_SCALE / renderDpr()));
}

/**
 * The always-present bitmap under the tiling layer. Kept in its own component
 * so it can subscribe to the quantized scale — `renderPage` is a plain callback
 * and can't hold hooks of its own.
 */
function BaseRender({ documentId, pageIndex }: { documentId: string; pageIndex: number }) {
  const baseScale = useBaseScale(documentId);
  return (
    <RenderLayer
      documentId={documentId}
      pageIndex={pageIndex}
      scale={baseScale}
      // explicit dpr: RenderLayer otherwise uses the raw devicePixelRatio,
      // which is 3 on modern phones and blows the iOS canvas budget
      dpr={renderDpr()}
      draggable={false}
      style={{ WebkitUserDrag: 'none', userSelect: 'none' } as any}
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

/**
 * How wide the context panel may be dragged. Read at drag time, not captured,
 * so the ceiling tracks a resized window. Answers get long and equations get
 * wide — a fixed cap made the pane the constraint rather than the content.
 */
const maxPanelW = () => Math.round(window.innerWidth * 0.7);

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

/**
 * Resolves the target PDF from the address bar and loads it.
 *
 * The blob is fetched here rather than handed to EmbedPDF as a URL so that a
 * blocked or missing document surfaces as a readable message instead of an
 * empty viewer, and so the proxy fallback can kick in.
 */
function usePdfDocument() {
  const source = useMemo(
    () => resolvePdfSource(window.location.href, window.location.origin),
    [],
  );
  const [state, setState] = useState<{
    url: string | null;
    error: string | null;
    loading: boolean;
    // No target in the URL means show the landing page, NOT a default paper.
  }>({ url: null, error: null, loading: Boolean(source.url) });

  useEffect(() => {
    if (!source.url) return;
    const ctrl = new AbortController();
    let objectUrl: string | null = null;
    fetchPdf(source.url, ctrl.signal)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setState({ url: objectUrl, error: null, loading: false });
      })
      .catch((e) => {
        if (ctrl.signal.aborted) return;
        setState({ url: null, error: String(e?.message ?? e), loading: false });
      });
    return () => {
      ctrl.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [source.url]);

  return { ...state, label: source.label, target: source.url };
}

export default function App() {
  const { engine, isLoading } = usePdfiumEngine();
  const doc = usePdfDocument();
  // A document opened from the landing page (dropped file or the demo).
  const [picked, setPicked] = useState<{ url: string; label: string } | null>(null);
  const activeUrl = doc.url ?? picked?.url ?? null;
  const activeLabel = doc.url ? doc.label : (picked?.label ?? '');
  const plugins = useMemo(() => (activeUrl ? buildPlugins(activeUrl) : null), [activeUrl]);
  const isMobile = useIsMobile();
  // Desktop starts with both panes open; mobile starts on the PDF alone.
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile);
  const [panelOpen, setPanelOpen] = useState(!isMobile);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarW, setSidebarW] = useState(190);
  const [panelW, setPanelW] = useState(360);

  // Crossing the breakpoint resets to that layout's sensible default, and
  // guarantees we never leave a mobile overlay stuck open on desktop.
  useEffect(() => {
    setSidebarOpen(!isMobile);
    setPanelOpen(!isMobile);
  }, [isMobile]);

  // Bind the chat to whichever document is open: restores its saved thread and
  // makes subsequent messages save under that document's key.
  useEffect(() => {
    if (!activeUrl) return;
    // A dropped file's blob: URL is regenerated every open, so it cannot
    // identify the document — documentKey falls back to the name for those.
    const reopenable = doc.target ?? (picked && !picked.url.startsWith('blob:') ? picked.url : null);
    const label = activeLabel || 'document';
    void chatStore.bindDocument({
      key: documentKey(reopenable ?? activeUrl, label),
      url: reopenable,
      label,
    });
  }, [activeUrl, activeLabel, doc.target, picked]);

  // The 70% ceiling is relative to the window, so shrinking it can strand the
  // panel above the limit. Pull it back rather than let it crowd out the PDF.
  useEffect(() => {
    const onResize = () => setPanelW((w) => Math.min(w, maxPanelW()));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  /**
   * Back to the landing page.
   *
   * Two ways in, so two ways out: a paper named in the URL has to be navigated
   * away from or resolvePdfSource would just reopen it, while one picked from
   * the landing page is only React state. Either way the selections and the
   * conversation are dropped — they refer to pages of the document being left,
   * and the navigation path would discard them regardless.
   */
  const goHome = () => {
    regionStore.clear();
    chatStore.reset();
    if (doc.target) {
      window.location.href = window.location.origin + '/';
      return;
    }
    setPicked(null);
  };

  // On mobile the panels are overlays, so only one may be open at a time.
  const openSidebar = (v: boolean) => {
    setSidebarOpen(v);
    if (v && isMobile) setPanelOpen(false);
  };
  const openPanel = (v: boolean) => {
    setPanelOpen(v);
    if (v && isMobile) setSidebarOpen(false);
  };

  if (doc.error) {
    return (
      <div className="dd-boot dd-boot-error">
        <h1>Could not open that PDF</h1>
        <p>{doc.error}</p>
        <p className="dd-boot-hint">
          Put a PDF link straight after the address, e.g.
          <code>{window.location.origin}/https://arxiv.org/pdf/1907.04392</code>
        </p>
        <a className="dd-primary" href={window.location.origin + '/'}>
          Back to start
        </a>
      </div>
    );
  }

  // Nothing requested in the URL and nothing chosen yet → landing page.
  if (!doc.loading && !activeUrl) {
    return <Landing onOpen={(url, label) => setPicked({ url, label })} />;
  }

  if (isLoading || !engine || doc.loading || !plugins) {
    return (
      <div className="dd-boot">
        <div className="dd-spinner" />
        <span>{doc.loading ? `fetching ${doc.label}…` : 'loading PDFium engine…'}</span>
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
                <div
                  className={`dd-app ${isMobile ? 'is-mobile' : ''} ${
                    panelOpen ? 'panel-open' : ''
                  }`}
                >
                  <header className="dd-top dd-no-interaction">
                    {/* logo is desktop-only — the phone needs the width for tools */}
                    <h1 className="dd-logo">
                      <button
                        className="dd-home"
                        onClick={goHome}
                        title="Back to the landing page"
                      >
                        drawde
                      </button>{' '}
                      <span>{activeLabel}</span>
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
                        {/* pinch only — wheel is handled by CtrlWheelZoom so the
                            sensitivity is tunable (see its comment) */}
                        <ZoomGestureWrapper
                          documentId={activeDocumentId}
                          enableWheel={false}
                        >
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
                              <BaseRender
                                documentId={activeDocumentId}
                                pageIndex={pageIndex}
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
                        </ZoomGestureWrapper>
                      </Viewport>
                      <TextSelectionBridge documentId={activeDocumentId} />
                      <NavHost documentId={activeDocumentId} />
                      <CtrlWheelZoom documentId={activeDocumentId} />
                      <SearchBar documentId={activeDocumentId} />
                    </div>

                    {panelOpen && !isMobile && (
                      <Splitter
                        side="right"
                        onDrag={(dx) => setPanelW((w) => clamp(w + dx, 240, maxPanelW()))}
                      />
                    )}
                    {panelOpen && (
                      <SelectionPanel
                        width={isMobile ? undefined : panelW}
                        onClose={isMobile ? () => setPanelOpen(false) : undefined}
                        onOpenSettings={() => setSettingsOpen(true)}
                      />
                    )}
                  </main>

                  {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
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

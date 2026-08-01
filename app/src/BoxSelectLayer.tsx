import { useEffect, useRef, useState } from 'react';
import { useInteractionManagerCapability } from '@embedpdf/plugin-interaction-manager/react';
import { useRenderCapability } from '@embedpdf/plugin-render/react';
import { useDocumentState } from '@embedpdf/core/react';
import type { Position } from '@embedpdf/models';
import { CROP_SCALE, type Rect, type Region } from './types';
import { nextRegionId, regionStore, useRegionsForPage } from './store';
import { chatStore } from './chat';
import { BOX_MODE } from './modes';
import { selectionMode } from './selection-mode';

interface Props {
  documentId: string;
  pageIndex: number;
}

const norm = (a: Position, b: Position): Rect => ({
  origin: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) },
  size: { width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) },
});

/** Kick off the high-DPI crop render and attach it to the region when it lands. */
function renderCrop(
  render: ReturnType<typeof useRenderCapability>['provides'],
  documentId: string,
  pageIndex: number,
  rect: Rect,
  regionId: string,
) {
  if (!render) return;
  const task = render.forDocument(documentId).renderPageRect({
    pageIndex,
    rect,
    options: { scaleFactor: CROP_SCALE },
  });
  task.wait(
    async (blob: Blob) => {
      // keep a base64 copy too: object URLs can't be sent to the model API
      const base64 = await blobToBase64(blob);
      regionStore.update(regionId, {
        imageUrl: URL.createObjectURL(blob),
        imageBase64: base64,
        pending: false,
      });
      // Recognise straight away rather than at send time: the LaTeX is the
      // thing you check before asking, and waiting until Send is what made it
      // arrive too late to be worth reading. Queued, so rapid multi-select
      // doesn't start several model loads.
      void chatStore.ocrPending();
    },
    () => regionStore.update(regionId, { pending: false }),
  );
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1] ?? '');
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

/**
 * Per-page layer that owns drawde's rectangle selection:
 *  - drag to draw a box (in BOX mode)
 *  - plain drag replaces the selection; shift-drag adds to it
 *  - committed boxes persist, each with a ✕ to remove
 */
export function BoxSelectLayer({ documentId, pageIndex }: Props) {
  const { provides: interaction } = useInteractionManagerCapability();
  const { provides: render } = useRenderCapability();
  const [preview, setPreview] = useState<Rect | null>(null);
  const regions = useRegionsForPage(pageIndex);
  // page coords → CSS px. PageLayout carries no scale, so read it off document state
  // the same way PagePointerProvider does.
  const documentState = useDocumentState(documentId);
  const scale = documentState?.scale ?? 1;

  // refs so the handler closure (registered once) always sees fresh values
  const startRef = useRef<Position | null>(null);
  const additiveRef = useRef(false);
  const renderRef = useRef(render);
  renderRef.current = render;

  useEffect(() => {
    if (!interaction) return;
    return interaction.registerHandlers({
      documentId,
      modeId: BOX_MODE,
      pageIndex,
      handlers: {
        onPointerDown: (pos, evt) => {
          startRef.current = pos;
          // Additive when Shift is held OR selection-lock is on (the touch path).
          // NB: ctrl is excluded — ctrl+drag/scroll is reserved for zoom.
          if (evt?.shiftKey || evt?.metaKey) selectionMode.setShift(true);
          additiveRef.current = selectionMode.isAdditive;
          // keep receiving move/up even when the pointer leaves the page element
          evt?.setPointerCapture?.();
          setPreview({ origin: { x: pos.x, y: pos.y }, size: { width: 0, height: 0 } });
        },
        onPointerMove: (pos) => {
          if (!startRef.current) return;
          setPreview(norm(startRef.current, pos));
        },
        onPointerUp: (pos, evt) => {
          const start = startRef.current;
          startRef.current = null;
          setPreview(null);
          evt?.releasePointerCapture?.();
          if (!start) return;

          const rect = norm(start, pos);
          // ignore stray clicks
          if (rect.size.width < 4 || rect.size.height < 4) return;

          const region: Region = {
            id: nextRegionId(),
            kind: 'box',
            pageIndex,
            rect,
            pending: true,
            createdAt: Date.now(),
          };
          if (additiveRef.current) regionStore.add(region);
          else regionStore.replace(region);

          renderCrop(renderRef.current, documentId, pageIndex, rect, region.id);
        },
        onPointerCancel: () => {
          startRef.current = null;
          setPreview(null);
        },
      },
    });
  }, [interaction, documentId, pageIndex]);

  const toCss = (r: Rect) => ({
    left: r.origin.x * scale,
    top: r.origin.y * scale,
    width: r.size.width * scale,
    height: r.size.height * scale,
  });

  return (
    <div className="dd-layer" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 3 }}>
      {regions.map((r, i) => (
        <div key={r.id} className="dd-rect" style={{ position: 'absolute', ...toCss(r.rect) }}>
          <span className="dd-rect-num">{i + 1}</span>
          <button
            className="dd-rect-x"
            title="Remove selection"
            onPointerDown={(e) => {
              // don't let the page's pointer provider start a new drag
              e.stopPropagation();
              e.preventDefault();
            }}
            onClick={(e) => {
              e.stopPropagation();
              regionStore.remove(r.id);
            }}
          >
            ×
          </button>
        </div>
      ))}
      {preview && <div className="dd-rect dd-rect-preview" style={{ position: 'absolute', ...toCss(preview) }} />}
    </div>
  );
}

import { useEffect, useState } from 'react';
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
import { ZoomPluginPackage, useZoom } from '@embedpdf/plugin-zoom/react';

import { BoxSelectLayer } from './BoxSelectLayer';
import { SelectionPanel } from './SelectionPanel';
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
  createPluginRegistration(ZoomPluginPackage),
];

/** Registers drawde's box mode and binds R / T. */
function ModeController({ documentId }: { documentId: string }) {
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
        <kbd>Shift</kbd> to add to selection
      </span>
      <ZoomControls />
    </div>
  );
}

function ZoomControls() {
  const { provides: zoom, state } = useZoom();
  const pct = Math.round((state?.currentZoomLevel ?? 1) * 100);
  return (
    <span className="dd-zoom">
      <button onClick={() => zoom?.zoomOut()}>−</button>
      <span>{Number.isFinite(pct) ? pct : 100}%</span>
      <button onClick={() => zoom?.zoomIn()}>+</button>
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

export default function App() {
  const { engine, isLoading } = usePdfiumEngine();

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
                    <ModeController documentId={activeDocumentId} />
                  </header>

                  <main className="dd-main">
                    <div className="dd-viewer">
                      <Viewport documentId={activeDocumentId} className="dd-viewport">
                        <Scroller
                          documentId={activeDocumentId}
                          renderPage={({ pageIndex }: { pageIndex: number }) => (
                            <PagePointerProvider
                              documentId={activeDocumentId}
                              pageIndex={pageIndex}
                            >
                              <RenderLayer documentId={activeDocumentId} pageIndex={pageIndex} />
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
                    </div>

                    <SelectionPanel />
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

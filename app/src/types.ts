/**
 * The universal currency of drawde.
 *
 * A Region is produced by ANY selection gesture — box drag, text drag, or (later)
 * an AI tool call. Everything downstream (OCR, LLM gap-filling, annotation export)
 * consumes Regions, so text and box selection stop being separate features.
 *
 * See docs/architecture-notes.md.
 */
export type RegionKind = 'box' | 'text';

export interface Rect {
  origin: { x: number; y: number };
  size: { width: number; height: number };
}

export interface Region {
  id: string;
  kind: RegionKind;
  pageIndex: number;
  /** PDF page coordinates (unscaled) — resolution independent */
  rect: Rect;
  /** for text regions: the individual highlight rects that make up the selection */
  subRects?: Rect[];
  /** text-layer content, if any. Glyph soup is fine — it still carries the symbols. */
  text?: string;
  /** high-DPI crop, rendered at CROP_SCALE */
  imageUrl?: string;
  /** same crop as base64 (no data: prefix) — what the model API wants */
  imageBase64?: string;
  /** LaTeX from local OCR, once recognised */
  latex?: string;
  /** OCR lifecycle for this region */
  ocrState?: 'idle' | 'running' | 'done' | 'error';
  ocrError?: string;
  /** set while the crop is being rendered */
  pending?: boolean;
  createdAt: number;
}

/** Scale factor for the crop we hand to OCR/multimodal models. */
export const CROP_SCALE = 4;

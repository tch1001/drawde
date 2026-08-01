import { useSyncExternalStore } from 'react';

/**
 * LLM providers.
 *
 * All four are callable directly from the browser — verified by live CORS
 * preflight against each endpoint, not assumed:
 *   Anthropic  → access-control-allow-origin: *   (needs the
 *                anthropic-dangerous-direct-browser-access header, which the
 *                SDK sends under dangerouslyAllowBrowser)
 *   OpenAI     → echoes the request Origin
 *   Gemini     → echoes the request Origin
 *   Moonshot   → echoes the request Origin
 *
 * Every model here is multimodal, because drawde's whole input is images of
 * equations. A text-only model would silently ignore the crops.
 */
export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'moonshot';

export interface ModelDef {
  id: string;
  label: string;
  provider: ProviderId;
}

export interface ProviderDef {
  id: ProviderId;
  label: string;
  keyPrefix: string;
  keysUrl: string;
  models: ModelDef[];
}

export const PROVIDERS: ProviderDef[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    keyPrefix: 'sk-ant-',
    keysUrl: 'https://platform.claude.com/settings/keys',
    models: [
      { id: 'claude-opus-5', label: 'Claude Opus 5', provider: 'anthropic' },
      { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', provider: 'anthropic' },
      { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', provider: 'anthropic' },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', provider: 'anthropic' },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    keyPrefix: 'sk-',
    keysUrl: 'https://platform.openai.com/api-keys',
    models: [
      { id: 'gpt-5.2', label: 'GPT-5.2', provider: 'openai' },
      { id: 'gpt-5.2-mini', label: 'GPT-5.2 mini', provider: 'openai' },
      { id: 'gpt-4o', label: 'GPT-4o', provider: 'openai' },
    ],
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    keyPrefix: '',
    keysUrl: 'https://aistudio.google.com/apikey',
    models: [
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', provider: 'gemini' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'gemini' },
    ],
  },
  {
    id: 'moonshot',
    label: 'Moonshot (Kimi)',
    keyPrefix: 'sk-',
    keysUrl: 'https://platform.moonshot.ai/console/api-keys',
    models: [
      { id: 'kimi-latest', label: 'Kimi latest (vision)', provider: 'moonshot' },
      { id: 'moonshot-v1-32k-vision-preview', label: 'Moonshot v1 32k vision', provider: 'moonshot' },
    ],
  },
];

export const ALL_MODELS: ModelDef[] = PROVIDERS.flatMap((p) => p.models);
export function providerOf(id: ProviderId) {
  return PROVIDERS.find((p) => p.id === id)!;
}

/* ── key + model selection store ───────────────────────────────────────── */

const KEY_PREFIX = 'drawde.key.';
const MODEL_KEY = 'drawde.model';
const FONT_KEY = 'drawde.fontScale';

/** Chat text size, as a multiplier. Dense equations get read at arm's length. */
export const FONT_MIN = 0.8;
export const FONT_MAX = 1.8;
export const FONT_STEP = 0.1;

type Keys = Partial<Record<ProviderId, string>>;

class SettingsStore {
  private listeners = new Set<() => void>();
  private snapshot: { keys: Keys; persisted: boolean; modelId: string; fontScale: number };

  constructor() {
    const keys: Keys = {};
    let persisted = false;
    for (const p of PROVIDERS) {
      const s = sessionStorage.getItem(KEY_PREFIX + p.id);
      const l = localStorage.getItem(KEY_PREFIX + p.id);
      if (s || l) keys[p.id] = (s ?? l)!;
      if (l) persisted = true;
    }
    const stored = localStorage.getItem(MODEL_KEY);
    this.snapshot = {
      keys,
      persisted,
      modelId: stored ?? PROVIDERS[0].models[0].id,
      fontScale: clampFont(Number(localStorage.getItem(FONT_KEY)) || 1),
    };
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.snapshot;

  get keys() {
    return this.snapshot.keys;
  }

  keyFor(p: ProviderId) {
    return this.snapshot.keys[p] ?? null;
  }

  /** Models the user can actually run — i.e. whose provider has a key. */
  availableModels(): ModelDef[] {
    return ALL_MODELS.filter((m) => this.snapshot.keys[m.provider]);
  }

  /** The selected model, or the first available one if the selection is unusable. */
  activeModel(): ModelDef | null {
    const available = this.availableModels();
    return (
      available.find((m) => m.id === this.snapshot.modelId) ?? available[0] ?? null
    );
  }

  setKeys(keys: Keys, persist: boolean) {
    for (const p of PROVIDERS) {
      sessionStorage.removeItem(KEY_PREFIX + p.id);
      localStorage.removeItem(KEY_PREFIX + p.id);
      const v = keys[p.id]?.trim();
      if (v) (persist ? localStorage : sessionStorage).setItem(KEY_PREFIX + p.id, v);
    }
    const cleaned: Keys = {};
    for (const p of PROVIDERS) {
      const v = keys[p.id]?.trim();
      if (v) cleaned[p.id] = v;
    }
    this.snapshot = { ...this.snapshot, keys: cleaned, persisted: persist };
    // if the current model's provider just lost its key, fall back
    const still = this.activeModel();
    if (still && still.id !== this.snapshot.modelId) {
      this.snapshot = { ...this.snapshot, modelId: still.id };
      localStorage.setItem(MODEL_KEY, still.id);
    }
    this.listeners.forEach((l) => l());
  }

  setModel(id: string) {
    localStorage.setItem(MODEL_KEY, id);
    this.snapshot = { ...this.snapshot, modelId: id };
    this.listeners.forEach((l) => l());
  }

  /** Nudge the chat text size by ±FONT_STEP; persists across sessions. */
  bumpFontScale(delta: number) {
    const next = clampFont(this.snapshot.fontScale + delta);
    if (next === this.snapshot.fontScale) return;
    localStorage.setItem(FONT_KEY, String(next));
    this.snapshot = { ...this.snapshot, fontScale: next };
    this.listeners.forEach((l) => l());
  }

  resetFontScale() {
    localStorage.removeItem(FONT_KEY);
    this.snapshot = { ...this.snapshot, fontScale: 1 };
    this.listeners.forEach((l) => l());
  }
}

// rounded because repeated ±0.1 in binary floating point drifts to 1.0999999
function clampFont(v: number) {
  return Math.round(Math.min(FONT_MAX, Math.max(FONT_MIN, v)) * 100) / 100;
}

export const settingsStore = new SettingsStore();
export function useSettings() {
  return useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot);
}

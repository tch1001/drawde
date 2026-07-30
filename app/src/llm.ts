import Anthropic from '@anthropic-ai/sdk';
import { useSyncExternalStore } from 'react';
import type { Region } from './types';

/**
 * LLM access, behind a transport seam.
 *
 * Today: BrowserTransport — the user's own key, called straight from the page.
 * That works because api.anthropic.com serves CORS when the request carries
 * `anthropic-dangerous-direct-browser-access`, which the SDK sends when
 * `dangerouslyAllowBrowser` is set (verified against the live API by preflight:
 * without the header the origin is rejected outright).
 *
 * The scary flag name is about shipping YOUR key to users. Here the user pastes
 * their own, so a compromise costs them their key, not our account. The real
 * risks are XSS (we render untrusted PDF content — never innerHTML model output)
 * and the absence of a client-side spend ceiling.
 *
 * Later: a ServerTransport posting to our own endpoint for a metered tier. Both
 * consume the same buildPrompt() output, so only this file changes.
 */

const KEY_STORAGE = 'drawde.anthropic.key';
const MODEL = 'claude-opus-5';

/* ── key store ─────────────────────────────────────────────────────────── */

class ApiKeyStore {
  private listeners = new Set<() => void>();
  private snapshot: { key: string | null; persisted: boolean } = {
    key: null,
    persisted: false,
  };

  constructor() {
    // sessionStorage by default: the key dies with the tab. localStorage only
    // if the user explicitly asked us to remember it.
    const s = sessionStorage.getItem(KEY_STORAGE);
    const l = localStorage.getItem(KEY_STORAGE);
    this.snapshot = { key: s ?? l, persisted: Boolean(l) };
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.snapshot;

  get key() {
    return this.snapshot.key;
  }

  set(key: string | null, persist: boolean) {
    sessionStorage.removeItem(KEY_STORAGE);
    localStorage.removeItem(KEY_STORAGE);
    if (key) {
      (persist ? localStorage : sessionStorage).setItem(KEY_STORAGE, key);
    }
    this.snapshot = { key, persisted: Boolean(key && persist) };
    this.listeners.forEach((l) => l());
  }
}

export const apiKeyStore = new ApiKeyStore();
export function useApiKey() {
  return useSyncExternalStore(apiKeyStore.subscribe, apiKeyStore.getSnapshot);
}

/* ── prompt ────────────────────────────────────────────────────────────── */

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

/**
 * Build the message list. Regions come first and stay byte-identical across a
 * conversation so they form a cacheable prefix — follow-up questions about the
 * same selection then bill at cache-read rates.
 */
export function buildMessages(regions: Region[], history: ChatTurn[], question: string) {
  const content: any[] = [];

  regions.forEach((r, i) => {
    const label = `Selection ${i + 1} (page ${r.pageIndex + 1}, ${r.kind})`;
    if (r.kind === 'box' && r.imageBase64) {
      content.push({ type: 'text', text: label });
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: r.imageBase64 },
      });
      if (r.latex) {
        content.push({
          type: 'text',
          text: `Local OCR read this as LaTeX (may contain errors — trust the image where they disagree):\n${r.latex}`,
        });
      }
    }
    if (r.text) {
      content.push({ type: 'text', text: `${label} — text layer:\n${r.text}` });
    }
  });

  // Cache the selections; the question after this point varies per turn.
  if (content.length) {
    content[content.length - 1] = {
      ...content[content.length - 1],
      cache_control: { type: 'ephemeral' },
    };
  }

  const messages: any[] = [];
  if (content.length) messages.push({ role: 'user', content });
  history.forEach((t) => messages.push({ role: t.role, content: t.text }));
  messages.push({ role: 'user', content: question });
  return messages;
}

const SYSTEM = `You are drawde, a reading assistant for theoretical physics papers.

The user has selected regions of a paper — usually equations, sometimes prose.
Each selection is given as a high-resolution crop, optionally with local OCR
output and the PDF text layer beneath it. The image is authoritative: OCR and
the text layer are noisy hints for disambiguating symbols (v vs nu, a vs alpha),
not sources of truth.

When asked to fill in a derivation gap, show the intermediate steps that the
paper suppressed, in the paper's own notation and conventions. State any
assumption you had to make. If a step genuinely cannot be reconstructed from
what is shown, say so rather than inventing it.

Write mathematics as LaTeX delimited by $...$ or $$...$$.`;

/* ── transport ─────────────────────────────────────────────────────────── */

export interface LlmTransport {
  stream(
    regions: Region[],
    history: ChatTurn[],
    question: string,
    onDelta: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<string>;
}

class BrowserTransport implements LlmTransport {
  async stream(
    regions: Region[],
    history: ChatTurn[],
    question: string,
    onDelta: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    const apiKey = apiKeyStore.key;
    if (!apiKey) throw new Error('No API key set. Open Settings and add one.');

    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    let full = '';

    const stream = client.messages.stream(
      {
        model: MODEL,
        max_tokens: 8000,
        system: SYSTEM,
        messages: buildMessages(regions, history, question),
      },
      { signal },
    );

    stream.on('text', (delta: string) => {
      full += delta;
      onDelta(delta);
    });

    const final = await stream.finalMessage();
    // A refusal comes back as a normal 200 with empty/partial content — surface
    // it rather than showing the user a blank reply.
    if (final.stop_reason === 'refusal') {
      throw new Error('The model declined this request.');
    }
    return full;
  }
}

export const llm: LlmTransport = new BrowserTransport();

import Anthropic from '@anthropic-ai/sdk';
import { providerOf, settingsStore, type ModelDef } from './providers';
import type { Region } from './types';

/**
 * LLM access across providers, behind one transport seam.
 *
 * All calls go straight from the page with the user's own key. That works
 * because every provider here serves CORS to browsers (verified by live
 * preflight per endpoint — see providers.ts). The user supplies the key, so a
 * compromise costs them their key rather than our account; the real residual
 * risk is XSS, which is why model output is sanitised before render.
 *
 * A metered ServerTransport can be added later without touching prompt building.
 */

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

const SYSTEM = `You are drawde, a reading assistant for theoretical physics papers.

The user has selected regions of a paper — usually equations, sometimes prose.
Each selection is given as a high-resolution crop, optionally with OCR output
and the PDF text layer beneath it. The image is authoritative: OCR and the text
layer are noisy hints for disambiguating symbols (v vs nu, a vs alpha), not
sources of truth.

When asked to fill in a derivation gap, show the intermediate steps the paper
suppressed, in the paper's own notation and conventions. State any assumption
you had to make. If a step genuinely cannot be reconstructed from what is shown,
say so rather than inventing it.

Write mathematics as LaTeX delimited by $...$ or $$...$$.`;

/** Selections as provider-neutral parts, so each adapter can shape them. */
interface Part {
  kind: 'text' | 'image';
  text?: string;
  base64?: string;
}

function selectionParts(regions: Region[]): Part[] {
  const parts: Part[] = [];
  regions.forEach((r, i) => {
    const label = `Selection ${i + 1} (page ${r.pageIndex + 1}, ${r.kind})`;
    if (r.kind === 'box' && r.imageBase64) {
      parts.push({ kind: 'text', text: label });
      parts.push({ kind: 'image', base64: r.imageBase64 });
      if (r.latex) {
        parts.push({
          kind: 'text',
          text: `OCR read this as LaTeX (may contain errors — trust the image where they disagree):\n${r.latex}`,
        });
      }
    }
    if (r.text) parts.push({ kind: 'text', text: `${label} — text layer:\n${r.text}` });
  });
  return parts;
}

export interface LlmTransport {
  stream(
    regions: Region[],
    history: ChatTurn[],
    question: string,
    onDelta: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<string>;
}

/* ── shared SSE reader for the OpenAI-shaped APIs ──────────────────────── */

async function readSse(
  res: Response,
  onEvent: (json: any) => void,
  signal?: AbortSignal,
) {
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}${detail ? ` — ${detail.slice(0, 300)}` : ''}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    if (signal?.aborted) {
      await reader.cancel().catch(() => {});
      break;
    }
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const payload = t.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        onEvent(JSON.parse(payload));
      } catch {
        /* keep-alive or partial frame — ignore */
      }
    }
  }
}

/* ── adapters ──────────────────────────────────────────────────────────── */

async function streamAnthropic(
  model: ModelDef,
  apiKey: string,
  regions: Region[],
  history: ChatTurn[],
  question: string,
  onDelta: (t: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  const content: any[] = selectionParts(regions).map((p) =>
    p.kind === 'image'
      ? { type: 'image', source: { type: 'base64', media_type: 'image/png', data: p.base64 } }
      : { type: 'text', text: p.text },
  );
  // Cache the selections: follow-ups about the same equations bill at read rates.
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

  let full = '';
  const stream = client.messages.stream(
    { model: model.id, max_tokens: 8000, system: SYSTEM, messages },
    { signal },
  );
  stream.on('text', (d: string) => {
    full += d;
    onDelta(d);
  });
  const final = await stream.finalMessage();
  if (final.stop_reason === 'refusal') throw new Error('The model declined this request.');
  return full;
}

/** OpenAI and Moonshot share the chat-completions shape. */
async function streamOpenAiCompatible(
  model: ModelDef,
  apiKey: string,
  baseUrl: string,
  regions: Region[],
  history: ChatTurn[],
  question: string,
  onDelta: (t: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const content: any[] = selectionParts(regions).map((p) =>
    p.kind === 'image'
      ? { type: 'image_url', image_url: { url: `data:image/png;base64,${p.base64}` } }
      : { type: 'text', text: p.text },
  );

  const messages: any[] = [{ role: 'system', content: SYSTEM }];
  if (content.length) messages.push({ role: 'user', content });
  history.forEach((t) => messages.push({ role: t.role, content: t.text }));
  messages.push({ role: 'user', content: question });

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: model.id, messages, stream: true, max_tokens: 8000 }),
    signal,
  });

  let full = '';
  await readSse(
    res,
    (json) => {
      const d = json?.choices?.[0]?.delta?.content;
      if (typeof d === 'string' && d) {
        full += d;
        onDelta(d);
      }
    },
    signal,
  );
  return full;
}

async function streamGemini(
  model: ModelDef,
  apiKey: string,
  regions: Region[],
  history: ChatTurn[],
  question: string,
  onDelta: (t: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const parts: any[] = selectionParts(regions).map((p) =>
    p.kind === 'image'
      ? { inline_data: { mime_type: 'image/png', data: p.base64 } }
      : { text: p.text },
  );

  const contents: any[] = [];
  if (parts.length) contents.push({ role: 'user', parts });
  history.forEach((t) =>
    contents.push({ role: t.role === 'assistant' ? 'model' : 'user', parts: [{ text: t.text }] }),
  );
  contents.push({ role: 'user', parts: [{ text: question }] });

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.id)}` +
    `:streamGenerateContent?alt=sse`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents,
      systemInstruction: { parts: [{ text: SYSTEM }] },
    }),
    signal,
  });

  let full = '';
  await readSse(
    res,
    (json) => {
      const cand = json?.candidates?.[0];
      for (const p of cand?.content?.parts ?? []) {
        if (typeof p?.text === 'string' && p.text) {
          full += p.text;
          onDelta(p.text);
        }
      }
    },
    signal,
  );
  return full;
}

/* ── dispatch ──────────────────────────────────────────────────────────── */

class MultiProviderTransport implements LlmTransport {
  async stream(
    regions: Region[],
    history: ChatTurn[],
    question: string,
    onDelta: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    const model = settingsStore.activeModel();
    if (!model) {
      throw new Error('No model available. Open Settings and add an API key.');
    }
    const apiKey = settingsStore.keyFor(model.provider);
    if (!apiKey) {
      throw new Error(
        `No ${providerOf(model.provider).label} API key set. Open Settings and add one.`,
      );
    }

    switch (model.provider) {
      case 'anthropic':
        return streamAnthropic(model, apiKey, regions, history, question, onDelta, signal);
      case 'openai':
        return streamOpenAiCompatible(
          model, apiKey, 'https://api.openai.com/v1',
          regions, history, question, onDelta, signal,
        );
      case 'moonshot':
        return streamOpenAiCompatible(
          model, apiKey, 'https://api.moonshot.ai/v1',
          regions, history, question, onDelta, signal,
        );
      case 'gemini':
        return streamGemini(model, apiKey, regions, history, question, onDelta, signal);
    }
  }
}

export const llm: LlmTransport = new MultiProviderTransport();

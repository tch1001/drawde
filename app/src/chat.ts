import { useSyncExternalStore } from 'react';
import { ocr } from './ocr';
import { llm, type ChatTurn } from './llm';
import { regionStore } from './store';
import type { Region } from './types';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  streaming?: boolean;
  error?: string;
  /**
   * What was selected when this question was asked, frozen at send time.
   * The live context is emptied on send, so this is the only record of what
   * the question was actually about — and it owns its crops' object URLs.
   */
  contexts?: Region[];
}

export interface ChatState {
  messages: ChatMessage[];
  busy: boolean;
  /** null when idle; 0..1 while the OCR model downloads */
  modelProgress: number | null;
  status: string | null;
}

/**
 * Orchestrates the "Ask drawde" flow:
 *   OCR every box region locally → build one prompt → stream the answer.
 *
 * OCR results are cached on the Region, so asking a follow-up about the same
 * selection doesn't re-run recognition.
 */
class ChatStore {
  private listeners = new Set<() => void>();
  private state: ChatState = {
    messages: [],
    busy: false,
    modelProgress: null,
    status: null,
  };
  private abort: AbortController | null = null;
  private seq = 0;
  /** Tail of the OCR queue — see runOcr. */
  private ocrChain: Promise<void> = Promise.resolve();

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.state;

  private set(patch: Partial<ChatState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  private push(msg: ChatMessage) {
    this.state = { ...this.state, messages: [...this.state.messages, msg] };
    this.listeners.forEach((l) => l());
  }

  private patchMessage(id: string, patch: Partial<ChatMessage>) {
    this.state = {
      ...this.state,
      messages: this.state.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    };
    this.listeners.forEach((l) => l());
  }

  clear() {
    this.abort?.abort();
    // The messages own their snapshots' crops (regionStore.detach handed them
    // over without revoking), so dropping the thread has to free them.
    this.state.messages.forEach((m) =>
      m.contexts?.forEach((r) => r.imageUrl && URL.revokeObjectURL(r.imageUrl)),
    );
    this.set({ messages: [], busy: false, status: null });
  }

  stop() {
    this.abort?.abort();
    this.set({ busy: false, status: null });
  }

  /**
   * OCR every box region that hasn't been recognised yet.
   *
   * Serialised through a single chain: selections arrive one drag at a time, so
   * without this each new crop would race the last into ocr.warm() and the
   * `ocrState !== 'running'` guard — which is only set once the loop reaches a
   * region — would let the same equation be recognised twice. Awaiting the tail
   * also means ask() transparently waits for any auto-OCR still in flight.
   */
  runOcr(regions: Region[]): Promise<void> {
    this.ocrChain = this.ocrChain.then(() => this.runOcrNow(regions)).catch(() => {});
    return this.ocrChain;
  }

  /** OCR whatever is currently selected and not yet read. */
  ocrPending(): Promise<void> {
    return this.runOcr(regionStore.getSnapshot());
  }

  private async runOcrNow(regions: Region[]) {
    // re-read: a region passed in may have been recognised or removed while
    // this call sat in the queue
    const live = regionStore.getSnapshot();
    const todo = live.filter(
      (r) =>
        regions.some((x) => x.id === r.id) &&
        r.kind === 'box' &&
        r.imageBase64 &&
        !r.latex &&
        r.ocrState !== 'running',
    );
    if (!todo.length) return;

    const prior = this.state.status;
    this.set({ status: 'Loading OCR model…' });
    await ocr.warm((f) => this.set({ modelProgress: f }));
    this.set({ modelProgress: null });

    for (let i = 0; i < todo.length; i++) {
      const r = todo[i];
      this.set({ status: `Reading equation ${i + 1} of ${todo.length}…` });
      regionStore.update(r.id, { ocrState: 'running' });
      try {
        const blob = await fetch(r.imageUrl!).then((res) => res.blob());
        const latex = await ocr.recognize(blob);
        regionStore.update(r.id, { latex, ocrState: 'done' });
      } catch (err: any) {
        // OCR is a hint, not a hard dependency — the model still gets the image
        regionStore.update(r.id, {
          ocrState: 'error',
          ocrError: String(err?.message ?? err),
        });
      }
    }
    // Don't wipe "Thinking…" if a selection made mid-answer triggered this.
    this.set({ status: this.state.busy ? prior : null });
  }

  async ask(question: string) {
    if (this.state.busy) return;
    const regions = regionStore.getSnapshot();

    this.set({ busy: true });
    // Show the question with its selections straight away. These objects may
    // still be mid-OCR; the snapshot is replaced with the finished ones below.
    const userId = `m${++this.seq}`;
    this.push({ id: userId, role: 'user', text: question, contexts: regions });

    try {
      // OCR first, then detach: recognition writes results through the region
      // store, so emptying it any earlier would throw those results away.
      await this.runOcr(regions);
      const contexts = regionStore.detach();
      this.patchMessage(userId, { contexts });

      const assistantId = `m${++this.seq}`;
      this.push({ id: assistantId, role: 'assistant', text: '', streaming: true });
      this.set({ status: 'Thinking…' });

      const history: ChatTurn[] = this.state.messages
        .filter((m) => !m.streaming && m.text)
        .slice(0, -1)
        .map((m) => ({ role: m.role, text: m.text }));

      this.abort = new AbortController();
      // Every selection the conversation has been given, not just this turn's:
      // the live context is empty from here on, and a follow-up like "what
      // about the second term?" still refers to an earlier equation. This is
      // also what the model saw before — the selection used to persist across
      // turns and be re-sent each time — so the cost profile is unchanged.
      const seen = new Set<string>();
      const withLatex = this.state.messages
        .flatMap((m) => m.contexts ?? [])
        .filter((r) => !seen.has(r.id) && seen.add(r.id));

      await llm.stream(
        withLatex,
        history,
        question,
        (delta) => {
          const cur = this.state.messages.find((m) => m.id === assistantId);
          this.patchMessage(assistantId, { text: (cur?.text ?? '') + delta });
        },
        this.abort.signal,
      );

      this.patchMessage(assistantId, { streaming: false });
      this.set({ busy: false, status: null });
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      const last = this.state.messages[this.state.messages.length - 1];
      if (last?.role === 'assistant' && last.streaming) {
        this.patchMessage(last.id, { streaming: false, error: msg });
      } else {
        this.push({ id: `m${++this.seq}`, role: 'assistant', text: '', error: msg });
      }
      this.set({ busy: false, status: null, modelProgress: null });
    }
  }
}

export const chatStore = new ChatStore();
export function useChat() {
  return useSyncExternalStore(chatStore.subscribe, chatStore.getSnapshot);
}

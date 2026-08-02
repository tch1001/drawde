import { useSyncExternalStore } from 'react';
import { ocr } from './ocr';
import { llm, type ChatTurn } from './llm';
import { regionStore } from './store';
import { deleteSession, fromStored, loadSession, saveSession, toStored } from './persist';
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
  /** Which document this thread belongs to; null before one is open. */
  private doc: { key: string; url: string | null; label: string } | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Attach the store to a document: restore its saved thread, and from here on
   * save changes under its key.
   *
   * Ids are bumped past anything restored so a new message can never collide
   * with a loaded one — patchMessage matches on id, and a collision would edit
   * the wrong turn.
   */
  async bindDocument(doc: { key: string; url: string | null; label: string }) {
    if (this.doc?.key === doc.key) return;
    // Settle the outgoing thread first: a pending debounce would otherwise fire
    // after the swap and write the previous document's messages under the new
    // document's key.
    this.flushNow();
    this.doc = doc;
    const saved = await loadSession(doc.key);
    if (this.doc?.key !== doc.key) return; // a different document won the race
    const messages = saved ? fromStored(saved.messages) : [];
    for (const m of messages) {
      const n = Number(m.id.replace(/^m/, ''));
      if (Number.isFinite(n) && n > this.seq) this.seq = n;
    }
    this.set({ messages, busy: false, status: null });
  }

  /**
   * Debounced because streaming patches the assistant message on every delta;
   * writing each one would mean hundreds of IndexedDB transactions per answer.
   */
  private schedulePersist() {
    if (!this.doc) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      const doc = this.doc;
      if (!doc) return;
      void saveSession({
        key: doc.key,
        url: doc.url,
        label: doc.label,
        updatedAt: Date.now(),
        messages: toStored(this.state.messages),
      });
    }, 500);
  }

  /** Write any debounced change out now, under the document it belongs to. */
  private flushNow() {
    if (!this.saveTimer || !this.doc) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    void saveSession({
      key: this.doc.key,
      url: this.doc.url,
      label: this.doc.label,
      updatedAt: Date.now(),
      messages: toStored(this.state.messages),
    });
  }

  /**
   * Leave the document without touching what was saved.
   *
   * Distinct from clear(): closing a paper should leave its thread in the
   * recent list, whereas clear() is the user deliberately throwing it away.
   */
  reset() {
    this.abort?.abort();
    this.flushNow();
    this.state.messages.forEach((m) =>
      m.contexts?.forEach((r) => r.imageUrl?.startsWith('blob:') && URL.revokeObjectURL(r.imageUrl)),
    );
    this.doc = null;
    this.set({ messages: [], busy: false, status: null });
  }

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
    this.schedulePersist();
  }

  private patchMessage(id: string, patch: Partial<ChatMessage>) {
    this.state = {
      ...this.state,
      messages: this.state.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    };
    this.listeners.forEach((l) => l());
    this.schedulePersist();
  }

  clear() {
    this.abort?.abort();
    // The messages own their snapshots' crops (regionStore.detach handed them
    // over without revoking), so dropping the thread has to free them.
    // restored threads carry data: URLs, which own nothing and must not be revoked
    this.state.messages.forEach((m) =>
      m.contexts?.forEach((r) => r.imageUrl?.startsWith('blob:') && URL.revokeObjectURL(r.imageUrl)),
    );
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (this.doc) void deleteSession(this.doc.key);
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

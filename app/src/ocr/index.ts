/**
 * OCR behind an interface, so the engine is swappable.
 *
 * Texo is excellent for this job (20M params, runs client-side, no API key) but
 * is AGPL-3.0 with weights shipped to the browser. Everything above this module
 * talks to `OcrEngine`, so replacing it — with a permissive local model or a
 * server-side one — is a one-file change.
 */
export interface OcrEngine {
  /** Begin downloading/compiling the model. Safe to call repeatedly. */
  warm(onProgress?: (fraction: number) => void): Promise<void>;
  /** Image of a single equation → LaTeX. */
  recognize(blob: Blob): Promise<string>;
}

type Pending = {
  resolve: (latex: string) => void;
  reject: (err: Error) => void;
};

class TexoEngine implements OcrEngine {
  private worker: Worker | null = null;
  private pending = new Map<number, Pending>();
  private warmed: Promise<void> | null = null;
  private progressCbs = new Set<(f: number) => void>();
  private seq = 0;

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = (e: MessageEvent) => {
      const { type, id, latex, message, loaded, total } = e.data ?? {};
      if (type === 'progress') {
        if (total) this.progressCbs.forEach((cb) => cb(loaded / total));
        return;
      }
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      if (type === 'result') p.resolve(latex ?? '');
      else if (type === 'ready') p.resolve('');
      else p.reject(new Error(message ?? 'OCR failed'));
    };
    return this.worker;
  }

  private send(action: string, blob?: Blob): Promise<string> {
    const worker = this.ensureWorker();
    const id = ++this.seq;
    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ id, action, blob });
    });
  }

  warm(onProgress?: (fraction: number) => void): Promise<void> {
    if (onProgress) this.progressCbs.add(onProgress);
    // Model load is ~80 MB; share one in-flight warm across all callers.
    if (!this.warmed) {
      this.warmed = this.send('warm')
        .then(() => undefined)
        .catch((e) => {
          this.warmed = null; // let a later attempt retry
          throw e;
        });
    }
    return this.warmed.finally(() => {
      if (onProgress) this.progressCbs.delete(onProgress);
    });
  }

  async recognize(blob: Blob): Promise<string> {
    await this.warm();
    return this.send('recognize', blob);
  }
}

export const ocr: OcrEngine = new TexoEngine();

/// <reference lib="webworker" />
import {
  PreTrainedTokenizer,
  Tensor,
  VisionEncoderDecoderModel,
  cat,
  env,
} from '@huggingface/transformers';
import { preprocessImg, TEXO_INPUT_SIZE } from './imageProcessor';

/**
 * Texo (alephpi/FormulaNet) equation OCR, in a worker.
 *
 * A worker is not optional here: this is an autoregressive encoder-decoder, so
 * decoding is a synchronous loop that would otherwise freeze the viewer for the
 * whole recognition. Everything below runs off the main thread.
 *
 * Licence note: Texo is AGPL-3.0 and its weights ship to the browser. Kept
 * behind the OcrEngine interface in ./index.ts so it can be swapped.
 */
const MODEL_ID = 'alephpi/FormulaNet';

env.allowLocalModels = false;
// run the ONNX wasm backend in its own proxy worker so the decode loop can't
// stall this worker's message handling
if (env.backends.onnx.wasm) env.backends.onnx.wasm.proxy = true;

let model: VisionEncoderDecoderModel | null = null;
let tokenizer: PreTrainedTokenizer | null = null;
let loading: Promise<void> | null = null;

async function ensureLoaded() {
  if (model && tokenizer) return;
  if (!loading) {
    loading = (async () => {
      model = await VisionEncoderDecoderModel.from_pretrained(MODEL_ID, {
        dtype: 'fp32',
        progress_callback: (p: any) => {
          if (p?.status === 'progress' && p.total) {
            self.postMessage({
              type: 'progress',
              loaded: p.loaded,
              total: p.total,
              file: p.file,
            });
          }
        },
      });
      tokenizer = await PreTrainedTokenizer.from_pretrained(MODEL_ID);
    })();
  }
  await loading;
}

async function recognize(blob: Blob): Promise<string> {
  await ensureLoaded();
  const array = await preprocessImg(blob);
  const grey = new Tensor('float32', array, [1, 1, TEXO_INPUT_SIZE, TEXO_INPUT_SIZE]);
  // the encoder wants 3 channels; the model is trained on greyscale repeated
  const pixel_values = cat([grey, grey, grey], 1);
  const outputs = await model!.generate({ inputs: pixel_values });
  return tokenizer!.batch_decode(outputs as any, { skip_special_tokens: true })[0] ?? '';
}

self.onmessage = async (e: MessageEvent) => {
  const { id, action, blob } = e.data ?? {};
  try {
    if (action === 'warm') {
      await ensureLoaded();
      self.postMessage({ type: 'ready', id });
    } else if (action === 'recognize') {
      const latex = await recognize(blob);
      self.postMessage({ type: 'result', id, latex });
    }
  } catch (err: any) {
    self.postMessage({ type: 'error', id, message: String(err?.message ?? err) });
  }
};

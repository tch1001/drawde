import { useSyncExternalStore } from 'react';

/**
 * Additive-selection state, shared by the box layer, the text bridge, and the toolbar.
 *
 * Two ways to get additive ("add to context" instead of "replace"):
 *   - hold Shift  — the desktop muscle-memory path
 *   - lock it on  — a toggle, which is the only workable option on touch
 *
 * They're the same underlying idea, so they share one derived `isAdditive` value
 * and one piece of UI: pressing Shift lights up the same button the user can tap.
 */
class SelectionMode {
  private locked = false;
  private shift = false;
  private listeners = new Set<() => void>();
  private snapshot = { locked: false, shift: false, isAdditive: false };

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = () => this.snapshot;

  private emit() {
    this.snapshot = {
      locked: this.locked,
      shift: this.shift,
      isAdditive: this.locked || this.shift,
    };
    this.listeners.forEach((l) => l());
  }

  /** Read by pointer handlers at commit time — never stale. */
  get isAdditive() {
    return this.locked || this.shift;
  }

  toggleLock() {
    this.locked = !this.locked;
    this.emit();
  }

  setLocked(v: boolean) {
    if (this.locked === v) return;
    this.locked = v;
    this.emit();
  }

  setShift(v: boolean) {
    if (this.shift === v) return;
    this.shift = v;
    this.emit();
  }
}

export const selectionMode = new SelectionMode();

export function useSelectionMode() {
  return useSyncExternalStore(selectionMode.subscribe, selectionMode.getSnapshot);
}

// Track Shift globally. Sampled on pointerdown too, because keyup can beat
// pointerup and we'd otherwise lose the modifier mid-gesture.
window.addEventListener('keydown', (e) => {
  if (e.key === 'Shift') selectionMode.setShift(true);
});
window.addEventListener('keyup', (e) => {
  if (e.key === 'Shift') selectionMode.setShift(false);
});
window.addEventListener('blur', () => selectionMode.setShift(false));
window.addEventListener(
  'pointerdown',
  (e) => selectionMode.setShift(e.shiftKey || e.metaKey),
  true,
);

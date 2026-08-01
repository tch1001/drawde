import { useCallback, useSyncExternalStore } from 'react';
import type { Region } from './types';

/**
 * Tiny external store for selected Regions.
 * Deliberately framework-agnostic so the eventual AI command bus can push into
 * the same store the user's mouse writes to.
 */
class RegionStore {
  private regions: Region[] = [];
  private listeners = new Set<() => void>();

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = () => this.regions;

  private emit() {
    this.regions = [...this.regions];
    this.listeners.forEach((l) => l());
  }

  add(region: Region) {
    this.regions.push(region);
    this.emit();
  }

  /** Replace everything (non-additive selection). */
  replace(region: Region) {
    this.regions.forEach((r) => r.imageUrl && URL.revokeObjectURL(r.imageUrl));
    this.regions = [region];
    this.emit();
  }

  update(id: string, patch: Partial<Region>) {
    const i = this.regions.findIndex((r) => r.id === id);
    if (i === -1) return;
    this.regions[i] = { ...this.regions[i], ...patch };
    this.emit();
  }

  remove(id: string) {
    const r = this.regions.find((x) => x.id === id);
    if (r?.imageUrl) URL.revokeObjectURL(r.imageUrl);
    this.regions = this.regions.filter((x) => x.id !== id);
    this.emit();
  }

  clear() {
    this.regions.forEach((r) => r.imageUrl && URL.revokeObjectURL(r.imageUrl));
    this.regions = [];
    this.emit();
  }

  /**
   * Hand the current selection to a caller and empty the live context.
   *
   * Unlike clear() this does NOT revoke the object URLs: ownership moves to
   * the caller, which goes on rendering the crops. Revoking here would blank
   * every image in the message the selection was just attached to.
   */
  detach(): Region[] {
    const taken = this.regions;
    this.regions = [];
    this.emit();
    return taken;
  }
}

export const regionStore = new RegionStore();

export function useRegions(): Region[] {
  return useSyncExternalStore(regionStore.subscribe, regionStore.getSnapshot);
}

export function useRegionsForPage(pageIndex: number): Region[] {
  const all = useRegions();
  return all.filter((r) => r.pageIndex === pageIndex);
}

export function useRegionActions() {
  return {
    add: useCallback((r: Region) => regionStore.add(r), []),
    remove: useCallback((id: string) => regionStore.remove(id), []),
    clear: useCallback(() => regionStore.clear(), []),
  };
}

let counter = 0;
export const nextRegionId = () => `region-${++counter}`;

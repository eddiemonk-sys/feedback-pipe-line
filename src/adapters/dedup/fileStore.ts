import { dirname } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import type { DedupStore } from "../../core/ports.js";

/**
 * Dependency-free DedupStore backed by a JSON file. Keyed on `channelId:messageTs`.
 *
 * Storage format: `{ "key": "pageId", ... }` for single entries,
 * `{ "key": ["pageId1", "pageId2"] }` for batch entries.
 * Backward compatible: if the file contains the old array format `["key", ...]`
 * it is migrated on load (pageIds become null).
 *
 * Chosen over SQLite to avoid needing a native build toolchain on the host.
 * Adequate for a single-process bot; swap in SQLite/Redis via the port if needed.
 */
export class FileDedupStore implements DedupStore {
  /** key → pageId (string for single, string[] for batch, null for legacy entries) */
  private store: Map<string, string | string[] | null>;
  private readonly path: string;

  constructor(filePath: string) {
    this.path = filePath;
    mkdirSync(dirname(filePath), { recursive: true });
    this.store = this.load();
  }

  private load(): Map<string, string | string[] | null> {
    if (!existsSync(this.path)) return new Map();
    try {
      const raw = readFileSync(this.path, "utf8").trim();
      if (!raw) return new Map();
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // Legacy format: migrate to map with null page IDs.
        const m = new Map<string, string | string[] | null>();
        for (const k of parsed) {
          if (typeof k === "string") m.set(k, null);
        }
        return m;
      }
      if (parsed && typeof parsed === "object") {
        const m = new Map<string, string | string[] | null>();
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (Array.isArray(v)) {
            m.set(k, v.filter((x): x is string => typeof x === "string"));
          } else {
            m.set(k, typeof v === "string" ? v : null);
          }
        }
        return m;
      }
      return new Map();
    } catch {
      // Corrupt file: start fresh rather than crash. Worst case is one re-capture.
      return new Map();
    }
  }

  private flush(): void {
    const obj: Record<string, string | string[] | null> = {};
    for (const [k, v] of this.store) obj[k] = v;
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(obj), "utf8");
    renameSync(tmp, this.path); // atomic replace
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  record(key: string, pageId: string): void {
    if (this.store.has(key)) return;
    this.store.set(key, pageId);
    this.flush();
  }

  recordMultiple(key: string, pageIds: string[]): void {
    if (this.store.has(key)) return;
    this.store.set(key, pageIds);
    this.flush();
  }

  getPageId(key: string): string | null {
    const val = this.store.get(key);
    if (val === undefined) return null;
    if (Array.isArray(val)) return val[0] ?? null;
    return val;
  }

  getPageIds(key: string): string[] {
    const val = this.store.get(key);
    if (!val) return [];
    if (Array.isArray(val)) return val;
    return [val]; // single string → wrap in array
  }

  delete(key: string): void {
    if (!this.store.has(key)) return;
    this.store.delete(key);
    this.flush();
  }

  findKeyByPageId(pageId: string): string | null {
    for (const [k, v] of this.store) {
      if (v === pageId) return k;
    }
    return null;
  }

  close(): void {
    this.flush();
  }
}

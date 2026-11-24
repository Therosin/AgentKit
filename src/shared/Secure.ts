/**
 * Secure value store and dot-path helpers for context isolation of sensitive
 * values.
 *
 * Values stored here are replaced in model-facing data with opaque
 * `secure://<uuid>` references. The raw value never enters conversation
 * context, tool results seen by the model, partial streams, or structured
 * output returned to the model.
 */

export interface SecureCreateOptions {
    /** Whether the reference may only be resolved once. Default false. */
    once?: boolean;
    /** Optional time-to-live in milliseconds. */
    ttlMs?: number;
}

export interface SecureEntry {
    value: unknown;
    once: boolean;
    expiresAt?: number;
}

const REF_PREFIX = 'secure://';

export function isSecureRef(value: unknown): value is string {
    return typeof value === 'string' && value.startsWith(REF_PREFIX);
}

export class SecureStore {
    readonly #entries = new Map<string, SecureEntry>();

    create(value: unknown, options: SecureCreateOptions = {}): string {
        const ref = `${REF_PREFIX}${crypto.randomUUID()}`;
        this.#entries.set(ref, {
            value,
            once: options.once ?? false,
            expiresAt: options.ttlMs !== undefined ? Date.now() + options.ttlMs : undefined,
        });
        return ref;
    }

    #entry(ref: string): SecureEntry | undefined {
        const entry = this.#entries.get(ref);
        if (!entry) return undefined;
        if (entry.expiresAt !== undefined && Date.now() >= entry.expiresAt) {
            this.#entries.delete(ref);
            return undefined;
        }
        return entry;
    }

    get(ref: string): unknown {
        return this.#entry(ref)?.value;
    }

    has(ref: string): boolean {
        return this.#entry(ref) !== undefined;
    }

    /** Consume and remove the entry, regardless of `once`. */
    take(ref: string): unknown {
        const entry = this.#entry(ref);
        if (!entry) return undefined;
        this.#entries.delete(ref);
        return entry.value;
    }

    /** Resolve a reference. Removes the entry when `once` is set. */
    resolve(ref: string): unknown {
        const entry = this.#entry(ref);
        if (!entry) return undefined;
        if (entry.once) this.#entries.delete(ref);
        return entry.value;
    }

    delete(ref: string): boolean {
        return this.#entries.delete(ref);
    }

    clear(): void {
        this.#entries.clear();
    }

    prune(): void {
        const now = Date.now();
        for (const [key, entry] of this.#entries) {
            if (entry.expiresAt !== undefined && now >= entry.expiresAt) {
                this.#entries.delete(key);
            }
        }
    }

    get size(): number {
        this.prune();
        return this.#entries.size;
    }
}

// ---------- dot-path helpers ----------

export function hasPath(target: unknown, path: string): boolean {
    if (!target || typeof target !== 'object') return false;
    const parts = path.split('.');
    let cur: unknown = target;
    for (const part of parts) {
        if (cur === null || typeof cur !== 'object') return false;
        if (!Object.prototype.hasOwnProperty.call(cur, part)) return false;
        cur = (cur as Record<string, unknown>)[part];
    }
    return true;
}

export function getPath(target: unknown, path: string): unknown {
    if (!target || typeof target !== 'object') return undefined;
    const parts = path.split('.');
    let cur: unknown = target;
    for (const part of parts) {
        if (cur === null || typeof cur !== 'object') return undefined;
        cur = (cur as Record<string, unknown>)[part];
    }
    return cur;
}

export function setPath(target: unknown, path: string, value: unknown): void {
    if (!target || typeof target !== 'object') return;
    const parts = path.split('.');
    let cur: any = target;
    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i]!;
        if (cur[part] === null || typeof cur[part] !== 'object') {
            cur[part] = {};
        }
        cur = cur[part];
    }
    cur[parts[parts.length - 1]!] = value;
}

export function deletePath(target: unknown, path: string): void {
    if (!target || typeof target !== 'object') return;
    const parts = path.split('.');
    let cur: any = target;
    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i]!;
        if (cur === null || typeof cur !== 'object') return;
        cur = cur[part];
        if (cur === undefined) return;
    }
    if (cur && typeof cur === 'object') {
        delete cur[parts[parts.length - 1]!];
    }
}

export interface NormalizedSecureSpec {
    paths: string[];
    once: boolean;
}

export function normalizeSecureSpec(spec: unknown): NormalizedSecureSpec {
    if (Array.isArray(spec)) {
        return { paths: spec.filter((p): p is string => typeof p === 'string'), once: false };
    }
    if (spec && typeof spec === 'object') {
        const obj = spec as Record<string, unknown>;
        const paths = Array.isArray(obj.paths)
            ? obj.paths.filter((p): p is string => typeof p === 'string')
            : [];
        return { paths, once: obj.once === true };
    }
    return { paths: [], once: false };
}

export function extractSecure(
    target: unknown,
    paths: string[],
    store: SecureStore,
    once = false,
): void {
    if (!target || typeof target !== 'object') return;
    for (const path of paths) {
        if (!hasPath(target, path)) continue;
        const value = getPath(target, path);
        const ref = store.create(value, { once });
        setPath(target, path, ref);
    }
}

export function resolveSecureInputs(
    target: unknown,
    paths: string[],
    store: SecureStore,
): unknown {
    if (!target || typeof target !== 'object') return target;
    for (const path of paths) {
        if (!hasPath(target, path)) continue;
        const value = getPath(target, path);
        if (isSecureRef(value)) {
            if (!store.has(value)) {
                throw new Error('Secure reference is unavailable or expired.');
            }
            const resolved = store.resolve(value);
            setPath(target, path, resolved);
        }
    }
    return target;
}

export function suppressSecure(target: unknown, paths: string[]): void {
    if (!target || typeof target !== 'object') return;
    for (const path of paths) {
        deletePath(target, path);
    }
}

export function cloneValue<T>(value: T): T {
    if (value === null || typeof value !== 'object') return value;
    try {
        return structuredClone(value);
    } catch {
        try {
            return JSON.parse(JSON.stringify(value));
        } catch {
            return value;
        }
    }
}

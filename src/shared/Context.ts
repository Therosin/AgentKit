/**
 * Base shape for typed context contracts.
 *
 * This does not describe or restrict the ambient Context registry.
 * It exists as a common base for typed context views and services.
 */
export type ContextShape = object;

/**
 * String keys declared by a context shape.
 */
export type ContextKey<T extends object> = Extract<keyof T, string>;

/**
 * A typed view over the ambient Context registry.
 *
 * The view does not own or copy any values. It constrains access to
 * the keys and value types declared by T.
 */
export interface ContextView<T extends object> {
    /**
     * Returns whether a value exists for the given context key.
     */
    has<K extends ContextKey<T>>(key: K): boolean;

    /**
     * Gets a value from the context.
     *
     * Throws if the key is not registered.
     */
    get<K extends ContextKey<T>>(key: K): T[K];

    /**
     * Gets a value from the context if it exists.
     */
    tryGet<K extends ContextKey<T>>(key: K): T[K] | undefined;

    /**
     * Sets a value in the context.
     *
     * Returns whether the value was accepted.
     */
    set<K extends ContextKey<T>>(key: K, value: T[K]): boolean;

    /**
     * Removes a value from the context.
     */
    delete<K extends ContextKey<T>>(key: K): boolean;
}


/**
 * ContextRegistry
 * 
 * Provides a shared context registry.
*/
export class ContextRegistry {
    readonly #values = new Map<string, unknown>();

    /**
     * Returns whether a value exists in the context.
     */
    has(key: string): boolean {
        return this.#values.has(key);
    }

    /**
     * Gets a value from the context.
     *
     * Throws if the key is not registered.
     */
    get<T = unknown>(key: string): T {
        if (!this.#values.has(key)) {
            throw new Error(`Context value "${key}" is not registered`);
        }

        return this.#values.get(key) as T;
    }

    /**
     * Gets a value from the context if it exists.
     */
    tryGet<T = unknown>(key: string): T | undefined {
        return this.#values.get(key) as T | undefined;
    }

    /**
     * Sets a value in the context.
     *
     * Returns whether the value was accepted.
     */
    set<T>(key: string, value: T): boolean {
        this.#values.set(key, value);
        return true;
    }

    /**
     * Removes a value from the context.
     */
    delete(key: string): boolean {
        return this.#values.delete(key);
    }

    /**
     * Returns a typed view over this context.
     *
     * The view does not create or copy context state. It only constrains
     * access to the supplied context shape at the type level.
     */
    view<T extends object>(): ContextView<T> {
        return this as unknown as ContextView<T>;
    }
}

const Context = new ContextRegistry();

export default Context;
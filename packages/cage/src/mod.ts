// noinspection JSUnusedGlobalSymbols, JSUnusedLocalSymbols

/**
 * Normalizes a single type or a tuple of types into a union of instance types.
 */
type ToInstanceUnion<T> = T extends unknown[] ? T[number] : T;

/**
 * Extracts the instance type from a Token constructor.
 */
type AsInstance<T> = T extends Token<infer I> ? I : T;

/**
 * Thrown when attempting to release a token from a Cage that has not been locked into the Rig.
 */
export class UnregisteredDependencyError extends Error {
    constructor(token: Token, captureFn?: CallableFunction) {
        super(`Unregistered dependency: ${token.name}`);
        this.name = "UnregisteredDependencyError";

        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, captureFn ?? this.constructor);
        }
    }
}

/**
 * Thrown when a dependency graph contains a cycle.
 */
export class CircularDependencyError extends Error {
    constructor(stack: Token[], captureFn?: CallableFunction) {
        const path = stack.map((t) => t.name).join(" -> ");

        super(`Circular dependency detected: ${path}`);
        this.name = "CircularDependencyError";

        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, captureFn ?? this.constructor);
        }
    }
}

/**
 * Represents a class constructor serving as a strict injection token.
 */
export interface Token<T = unknown> extends Function {
    readonly [Rig.token]: symbol;
    prototype: T;
}

/**
 * A function responsible for instantiating a class.
 */
export type Factory<TInstance = unknown, TRegistry = unknown> = (_: Cage<TRegistry, unknown>) => TInstance;

/**
 * A structure holding a factory function bound to the `Cage.bond` symbol.
 */
export type Captive<TToken extends Token, TRegistry = never> = {
    [Cage.bond]: (cage: Cage<TRegistry>) => TToken extends Token<infer TInstance> ? TInstance : never;
};

/**
 * Represents a single dependency mapping in the type-level graph.
 */
export type Node<TProvideToken, TRequireTokens> = { provide: TProvideToken; require: TRequireTokens };

/**
 * Extracts all the instance types from the graph into a single union.
 */
export type BuildRegistry<TGraph> = TGraph extends Node<Token<infer I>, unknown> ? I : never;

/**
 * Finds direct dependents of a specific target Token union within a graph.
 */
export type FindDependents<TGraph, TTargets> = TGraph extends Node<infer P, infer R>
    ? (Extract<ToInstanceUnion<R>, AsInstance<TTargets>> extends never ? never : P)
    : never;

/**
 * Recursively finds all dependents of a target Token union.
 */
export type GetAllDependents<TGraph, TTargets, TSeen = never> = FindDependents<TGraph, TTargets> extends infer NewTargets
    ? Exclude<NewTargets, TSeen> extends never ? TTargets
    : GetAllDependents<TGraph, TTargets | NewTargets, TSeen | NewTargets>
    : never;

/**
 * Removes a node and ALL of its dependents from a graph.
 */
export type Invalidate<TGraph, TOverrideToken, FullGraph = TGraph> = TGraph extends Node<infer P, unknown>
    ? P extends GetAllDependents<FullGraph, TOverrideToken> ? never : TGraph
    : never;

/**
 * Removes only the specified node from the graph.
 */
export type RemoveNode<TGraph, TToken> = TGraph extends Node<infer P, unknown> ? P extends TToken ? never : TGraph
    : never;

/**
 * The bounded execution context (Container).
 */
export class Cage<TRegistry = unknown, TGraph = never> {
    static readonly bond: unique symbol = Symbol("Cage.bond");

    declare readonly __registry: TRegistry;
    declare readonly __graph: TGraph;

    readonly #rig: Rig<unknown, boolean>;
    readonly #parent: Cage<unknown, unknown> | null;

    #resolutionStack?: Set<Token>;
    #cache?: Map<Token, unknown>;

    constructor(rig: Rig<unknown, boolean>, parent: Cage<unknown, unknown> | null = null) {
        this.#rig = rig;
        this.#parent = parent;
    }

    /**
     * Safely extracts an instantiated singleton.
     */
    release<TToken extends Token>(
        token: TToken & (TToken extends Token<infer I> ? (I extends ToInstanceUnion<TRegistry> ? unknown : never) : never),
        context: Cage<unknown, unknown> = this as unknown as Cage<unknown, unknown>,
    ): TToken extends Token<infer TInstance> ? TInstance : never {
        const t = token as unknown as Token;
        let instance = this.#cache?.get(t);

        if (!instance) {
            if (context.#resolutionStack?.has(t)) {
                throw new CircularDependencyError([...context.#resolutionStack, t], this.release);
            }

            if (this.#parent && !this.#rig.isSecured(t)) {
                // Drop 'context' parameter. Force parent to resolve via its own isolated context boundaries.
                return this.#parent.release(
                    t,
                ) as unknown as TToken extends Token<infer TInstance> ? TInstance : never;
            }

            (context.#resolutionStack ??= new Set()).add(t);

            try {
                const factory = this.#rig.keeperOf(t);

                if (factory) {
                    (this.#cache ??= new Map()).set(
                        t,
                        instance = (factory as Factory)(context as unknown as Cage),
                    );
                } else {
                    throw new UnregisteredDependencyError(t, this.release);
                }
            } finally {
                context.#resolutionStack?.delete(t);
            }
        }

        return instance as unknown as TToken extends Token<infer TInstance> ? TInstance : never;
    }

    /**
     * Overrides a specific dependency for a child scope.
     */
    lock<TToken extends Token, TReq = never>(
        token: TToken,
        captive:
            & Captive<TToken, TReq>
            & (Exclude<ToInstanceUnion<TReq>, BuildRegistry<TGraph>> extends never ? unknown : never),
    ): Rig<Invalidate<TGraph, TToken> | Node<TToken, TReq>, true> {
        return new Rig(token as Token, captive[Cage.bond].bind(captive) as Factory, this.#rig, this);
    }

    [Symbol.dispose](): void {
        if (this.#cache) {
            const instances = Array.from(this.#cache.values()).reverse();
            for (const instance of instances) {
                const type = typeof instance;
                if (instance && (type === "object" || type === "function")) {
                    const target = instance as object;
                    if (Symbol.dispose in target) {
                        (instance as Disposable)[Symbol.dispose]();
                    }
                }
            }
            this.#cache.clear();
        }
    }

    async [Symbol.asyncDispose](): Promise<void> {
        if (this.#cache) {
            const instances = Array.from(this.#cache.values()).reverse();
            for (const instance of instances) {
                const type = typeof instance;
                if (instance && (type === "object" || type === "function")) {
                    const target = instance as object;
                    if (Symbol.asyncDispose in target) {
                        await (instance as AsyncDisposable)[Symbol.asyncDispose]();
                    } else if (Symbol.dispose in target) {
                        (instance as Disposable)[Symbol.dispose]();
                    }
                }
            }
            this.#cache.clear();
        }
    }
}

/**
 * The immutable setup structure (Builder/Registry).
 */
export class Rig<TGraph = never, TIsStateful extends boolean = false> {
    static readonly token: unique symbol = Symbol("Rig.token");

    declare readonly __isStateful: TIsStateful;
    declare readonly __registry: TGraph;

    readonly #token: Token;
    readonly #factory: Factory;
    readonly #parent: Rig<unknown, boolean> | null;
    readonly #parentCage: Cage<unknown, unknown> | null;

    constructor(
        token: Token,
        factory: Factory,
        parent: Rig<unknown, boolean> | null = null,
        parentCage: Cage<unknown, unknown> | null = null,
    ) {
        this.#parent = parent;
        this.#token = token;
        this.#factory = factory;
        this.#parentCage = parentCage;
    }

    isSecured(token: Token): boolean {
        // deno-lint-ignore no-this-alias
        let current: Rig<unknown, boolean> | null = this;
        while (current !== null) {
            if (current.#token === token) return true;
            if (current.#parentCage !== this.#parentCage) break;
            current = current.#parent;
        }
        return false;
    }

    keeperOf<TRequested>(token: Token<TRequested>): Factory<TRequested> | undefined {
        // deno-lint-ignore no-this-alias
        let current: Rig<unknown, boolean> | null = this;
        while (current !== null) {
            if (current.#token === token) {
                return current.#factory as Factory<TRequested>;
            }
            current = current.#parent;
        }
        return undefined;
    }

    lock<TToken extends Token, TReq = never>(
        token: TToken,
        captive:
            & Captive<TToken, TReq>
            & (Exclude<ToInstanceUnion<TReq>, BuildRegistry<TGraph>> extends never ? unknown : never),
    ): Rig<
        (TIsStateful extends true ? Invalidate<TGraph, TToken> : RemoveNode<TGraph, TToken>) | Node<TToken, TReq>,
        TIsStateful
    > {
        return new Rig(token as Token, captive[Cage.bond].bind(captive) as Factory, this, this.#parentCage);
    }

    harness<TResult>(plugin: (rig: this) => TResult): TResult {
        return plugin(this);
    }

    enclose(): Cage<BuildRegistry<TGraph>, TGraph> {
        return new Cage<BuildRegistry<TGraph>, TGraph>(this, this.#parentCage);
    }

    static lock<TToken extends Token, TReq = never>(
        token: TToken,
        captive: Captive<TToken, TReq> & (Exclude<ToInstanceUnion<TReq>, never> extends never ? unknown : never),
    ): Rig<Node<TToken, TReq>> {
        return new Rig(token as Token, captive[Cage.bond].bind(captive) as Factory);
    }
}

/**
 * Subdues a raw, custom factory function into a compliant Captive object.
 */
export const tame = <TRegistry = never, TInstance = unknown>(
    callback: (c: Cage<TRegistry>) => TInstance,
): { [Cage.bond]: (cage: Cage<TRegistry>) => TInstance } => ({ [Cage.bond]: callback });

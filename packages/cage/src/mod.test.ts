// noinspection JSUnusedGlobalSymbols

import { assertEquals, assertInstanceOf, assertStrictEquals, assertThrows } from "@std/assert";
import { Cage, CircularDependencyError, Rig, tame, UnregisteredDependencyError } from "./mod.ts";

// ============================================================================
// DOMAIN 1: Base Application Architecture
// ============================================================================
abstract class IConfig {
    declare static readonly [Rig.token]: unique symbol;
    abstract readonly service: "Config";
    abstract get dbUrl(): string;
}

class EnvConfig implements IConfig {
    readonly service = "Config";
    get dbUrl() {
        return "postgres://prod";
    }
    static [Cage.bond]() {
        return new this();
    }
}

abstract class ILogger {
    declare static readonly [Rig.token]: unique symbol;
    abstract readonly service: "Logger";
    abstract logs: string[];
    abstract log(msg: string): void;
}

class MemoryLogger implements ILogger {
    readonly service = "Logger";
    logs: string[] = [];
    log(msg: string) {
        this.logs.push(msg);
    }
    static [Cage.bond]() {
        return new this();
    }
}

export let disposalLog: string[] = [];

abstract class IDatabase {
    declare static readonly [Rig.token]: unique symbol;
    abstract readonly service: "Database";
    abstract isConnected: boolean;
    abstract connect(): void;
}

class PostgresDB implements IDatabase, Disposable {
    readonly service = "Database";
    isConnected = false;
    constructor(public config: IConfig, public logger: ILogger) {}
    connect() {
        this.isConnected = true;
        this.logger.log(`Connected to ${this.config.dbUrl}`);
    }
    [Symbol.dispose]() {
        disposalLog.push("Database");
        this.isConnected = false;
        this.logger.log("DB Disposed");
    }
    static [Cage.bond](c: Cage<[IConfig, ILogger]>) {
        return new this(c.release(IConfig), c.release(ILogger));
    }
}

abstract class IConnectionPool {
    declare static readonly [Rig.token]: unique symbol;
    abstract readonly service: "Pool";
    abstract query(): void;
}

class ConnectionPool implements IConnectionPool, Disposable {
    readonly service = "Pool";
    constructor(public db: IDatabase) {}
    query() {
        if (!this.db.isConnected) throw new Error("DB not connected");
    }
    [Symbol.dispose]() {
        disposalLog.push("ConnectionPool");
    }
    static [Cage.bond](c: Cage<[IDatabase]>) {
        return new this(c.release(IDatabase));
    }
}

abstract class IController {
    declare static readonly [Rig.token]: unique symbol;
    abstract readonly service: "Controller";
    abstract handle(): void;
}

class WebController implements IController {
    readonly service = "Controller";
    constructor(public db: IDatabase, public logger: ILogger) {}
    handle() {
        this.db.connect();
        this.logger.log("Request handled");
    }
    static [Cage.bond](c: Cage<[IDatabase, ILogger]>) {
        return new this(c.release(IDatabase), c.release(ILogger));
    }
}

// ============================================================================
// DOMAIN 2: Deep Transitive Chains
// ============================================================================
abstract class ID {
    declare static readonly [Rig.token]: unique symbol;
    abstract val: string;
}
abstract class IC {
    declare static readonly [Rig.token]: unique symbol;
    abstract d: ID;
}
abstract class IB {
    declare static readonly [Rig.token]: unique symbol;
    abstract c: IC;
}
abstract class IA {
    declare static readonly [Rig.token]: unique symbol;
    abstract b: IB;
}

class DImpl implements ID {
    val = "D";
    static [Cage.bond]() {
        return new this();
    }
}
class CImpl implements IC {
    constructor(public d: ID) {}
    static [Cage.bond](c: Cage<[ID]>) {
        return new this(c.release(ID));
    }
}
class BImpl implements IB {
    constructor(public c: IC) {}
    static [Cage.bond](c: Cage<[IC]>) {
        return new this(c.release(IC));
    }
}
class AImpl implements IA {
    constructor(public b: IB) {}
    static [Cage.bond](c: Cage<[IB]>) {
        return new this(c.release(IB));
    }
}

// ============================================================================
// DOMAIN 3: The Diamond Problem
// ============================================================================
abstract class IDiaBottom {
    declare static readonly [Rig.token]: unique symbol;
    abstract id: number;
}
abstract class IDiaLeft {
    declare static readonly [Rig.token]: unique symbol;
    abstract bottom: IDiaBottom;
}
abstract class IDiaRight {
    declare static readonly [Rig.token]: unique symbol;
    abstract bottom: IDiaBottom;
}
abstract class IDiaTop {
    declare static readonly [Rig.token]: unique symbol;
    abstract left: IDiaLeft;
    abstract right: IDiaRight;
}

class DiaBottom implements IDiaBottom {
    static count = 0;
    id = ++DiaBottom.count;
    static [Cage.bond]() {
        return new this();
    }
}
class DiaLeft implements IDiaLeft {
    constructor(public bottom: IDiaBottom) {}
    static [Cage.bond](c: Cage<[IDiaBottom]>) {
        return new this(c.release(IDiaBottom));
    }
}
class DiaRight implements IDiaRight {
    constructor(public bottom: IDiaBottom) {}
    static [Cage.bond](c: Cage<[IDiaBottom]>) {
        return new this(c.release(IDiaBottom));
    }
}
class DiaTop implements IDiaTop {
    constructor(public left: IDiaLeft, public right: IDiaRight) {}
    // Proof that Cage fully supports standard Unions as an alternative to Tuples
    static [Cage.bond](c: Cage<IDiaLeft | IDiaRight>) {
        return new this(c.release(IDiaLeft), c.release(IDiaRight));
    }
}

// ============================================================================
// DOMAIN 4: Decoupled Pub/Sub Event Bus
// ============================================================================
abstract class IEventBus {
    declare static readonly [Rig.token]: unique symbol;
    abstract events: string[];
    abstract emit(e: string): void;
}
class EventBus implements IEventBus {
    events: string[] = [];
    emit(e: string) {
        this.events.push(e);
    }
    static [Cage.bond]() {
        return new this();
    }
}

abstract class IPublisher {
    declare static readonly [Rig.token]: unique symbol;
    abstract publish(e: string): void;
}
class Publisher implements IPublisher {
    constructor(public bus: IEventBus) {}
    publish(e: string) {
        this.bus.emit(e);
    }
    static [Cage.bond](c: Cage<[IEventBus]>) {
        return new this(c.release(IEventBus));
    }
}

abstract class ISubscriber {
    declare static readonly [Rig.token]: unique symbol;
    abstract last(): string | undefined;
}
class Subscriber implements ISubscriber {
    constructor(public bus: IEventBus) {}
    last() {
        return this.bus.events[this.bus.events.length - 1];
    }
    static [Cage.bond](c: Cage<[IEventBus]>) {
        return new this(c.release(IEventBus));
    }
}

// ============================================================================
// DOMAIN 5: Async & Mixed Disposables
// ============================================================================
export let asyncDisposalLog: string[] = [];

abstract class IAsyncResource {
    declare static readonly [Rig.token]: unique symbol;
    abstract val: string;
}
class AsyncResource implements IAsyncResource, AsyncDisposable {
    val = "Async";
    async [Symbol.asyncDispose]() {
        await new Promise((r) => setTimeout(r, 1));
        asyncDisposalLog.push("AsyncResource_Disposed");
    }
    static [Cage.bond]() {
        return new this();
    }
}

abstract class ISyncResource {
    declare static readonly [Rig.token]: unique symbol;
    abstract val: string;
}
class SyncResource implements ISyncResource, Disposable {
    val = "Sync";
    [Symbol.dispose]() {
        asyncDisposalLog.push("SyncResource_Disposed");
    }
    static [Cage.bond]() {
        return new this();
    }
}

abstract class IMixedResource {
    declare static readonly [Rig.token]: unique symbol;
}
class MixedResource implements IMixedResource, AsyncDisposable, Disposable {
    async [Symbol.asyncDispose]() {
        asyncDisposalLog.push("MixedResource_Async");
        await Promise.resolve();
    }
    [Symbol.dispose]() {
        asyncDisposalLog.push("MixedResource_Sync");
    } // Should be skipped in await using
    static [Cage.bond]() {
        return new this();
    }
}

// ============================================================================
// DOMAIN 6: Errors & Edge Cases
// ============================================================================
abstract class ICirc1 {
    declare static readonly [Rig.token]: unique symbol;
    abstract name: "c1";
}
abstract class ICirc2 {
    declare static readonly [Rig.token]: unique symbol;
    abstract name: "c2";
}
abstract class ICirc3 {
    declare static readonly [Rig.token]: unique symbol;
    abstract name: "c3";
}
class Circ1 implements ICirc1 {
    name = "c1" as const;
    constructor(_c: unknown) {}
    static [Cage.bond](c: Cage<[ICirc2]>) {
        return new this(c.release(ICirc2));
    }
}
class Circ2 implements ICirc2 {
    name = "c2" as const;
    constructor(_c: unknown) {}
    static [Cage.bond](c: Cage<[ICirc3]>) {
        return new this(c.release(ICirc3));
    }
}
class Circ3 implements ICirc3 {
    name = "c3" as const;
    constructor(_c: unknown) {}
    static [Cage.bond](c: Cage<[ICirc1]>) {
        return new this(c.release(ICirc1));
    }
}

abstract class ISelfCirc {
    declare static readonly [Rig.token]: unique symbol;
    abstract name: "self";
}
class SelfCirc implements ISelfCirc {
    name = "self" as const;
    constructor(_s: unknown) {}
    static [Cage.bond](c: Cage<[ISelfCirc]>) {
        return new this(c.release(ISelfCirc));
    }
}

abstract class IOptionalTarget {
    declare static readonly [Rig.token]: unique symbol;
    abstract val: string;
}
abstract class IOptionalConsumer {
    declare static readonly [Rig.token]: unique symbol;
    abstract hasOpt: boolean;
}
class OptConsumer implements IOptionalConsumer {
    hasOpt: boolean;
    constructor(opt: unknown) {
        this.hasOpt = !!opt;
    }
    static [Cage.bond](c: Cage<[IOptionalTarget]>) {
        let opt;
        try {
            opt = c.release(IOptionalTarget);
        } catch { /* Ignore */ }
        return new this(opt);
    }
}

// ============================================================================
// THE MASSIVE TEST SUITE
// ============================================================================
Deno.test("Cage Dependency Injection Engine - Comprehensive Suite", async (t) => {
    const baseAppRig = Rig.lock(IConfig, EnvConfig).lock(ILogger, MemoryLogger).lock(IDatabase, PostgresDB).lock(
        IConnectionPool,
        ConnectionPool,
    ).lock(IController, WebController);
    const deepRig = Rig.lock(ID, DImpl).lock(IC, CImpl).lock(IB, BImpl).lock(IA, AImpl);

    // --- Section 1: Core Instantiation & Graph Resolution ---

    await t.step("1. Core: Resolving a token with zero dependencies", () => {
        const rig = Rig.lock(ID, DImpl);
        using cage = rig.enclose();
        const d = cage.release(ID);
        assertInstanceOf(d, DImpl);
        assertEquals(d.val, "D");
    });

    await t.step("2. Core: Singleton reference stability", () => {
        using cage = deepRig.enclose();
        const a1 = cage.release(IA);
        const a2 = cage.release(IA);
        assertStrictEquals(a1, a2);
    });

    await t.step("3. Core: Multiple independent dependencies", () => {
        using cage = baseAppRig.enclose();
        assertInstanceOf(cage.release(IConfig), EnvConfig);
        assertInstanceOf(cage.release(ILogger), MemoryLogger);
    });

    await t.step("4. Core: Deep transitive dependency chain resolution", () => {
        using cage = deepRig.enclose();
        const a = cage.release(IA);
        assertEquals(a.b.c.d.val, "D");
    });

    await t.step("5. Core: Injection of pure falsy/primitive values via tame()", () => {
        abstract class IRaw {
            declare static readonly [Rig.token]: unique symbol;
            abstract raw: boolean;
        }
        const rig = Rig.lock(IRaw, tame(() => ({ raw: false })));
        using cage = rig.enclose();
        assertEquals(cage.release(IRaw).raw, false);
    });

    // --- Section 2: Hierarchical Scoping & Overrides ---

    await t.step("6. Hierarchy: Child container falls back to parent", () => {
        using rootCage = deepRig.enclose();
        const childRig = rootCage.lock(IEventBus, EventBus);
        using childCage = childRig.enclose();
        assertStrictEquals(childCage.release(ID), rootCage.release(ID));
    });

    await t.step("7. Hierarchy: Sibling containers remain totally isolated", () => {
        const rootRig = Rig.lock(IConfig, EnvConfig);
        const sib1Rig = rootRig.lock(ID, DImpl);
        const sib2Rig = rootRig.lock(ID, DImpl);
        using sib1Cage = sib1Rig.enclose();
        using sib2Cage = sib2Rig.enclose();
        assertStrictEquals(sib1Cage.release(ID) === sib2Cage.release(ID), false);
    });

    await t.step("8. Hierarchy: Child stateful override perfectly shadows parent", () => {
        using rootCage = deepRig.enclose();
        const rootD = rootCage.release(ID);

        class MockD implements ID {
            val = "Mock";
            static [Cage.bond]() {
                return new this();
            }
        }
        const childRig = rootCage.lock(ID, MockD);
        using childCage = childRig.enclose();
        const childD = childCage.release(ID);

        assertStrictEquals(rootD.val, "D");
        assertStrictEquals(childD.val, "Mock");
        assertStrictEquals(childD === rootD, false);
    });

    await t.step("9. Hierarchy: Grandchild properly delegates up to root cache", () => {
        using rootCage = deepRig.enclose();
        using childCage = rootCage.lock(IConfig, EnvConfig).enclose();
        using grandCage = childCage.lock(IEventBus, EventBus).enclose();
        assertStrictEquals(grandCage.release(ID), rootCage.release(ID));
    });

    await t.step("10. Hierarchy: Parent cannot resolve child-bound tokens", () => {
        using rootCage = deepRig.enclose();
        const childRig = rootCage.lock(IEventBus, EventBus);
        using _childCage = childRig.enclose();
        assertThrows(() => {
            // @ts-expect-error: Prevented at compile-time
            rootCage.release(IEventBus);
        }, UnregisteredDependencyError);
    });

    // --- Section 3: Captive Dependencies & Graph Invalidation ---

    await t.step("11. Stateful: Relocking foundational token drops direct dependents", () => {
        class NewD implements ID {
            val = "NewD";
            static [Cage.bond]() {
                return new this();
            }
        }
        using rootCage = deepRig.enclose();
        const overrideRig = rootCage.lock(ID, NewD);
        using cage = overrideRig.enclose();

        // @ts-expect-error: IA is dropped from the registry entirely
        const captiveA = cage.release(IA);
        // Resolves to the root cache, effectively acting as a captive dependency!
        assertEquals(captiveA.b.c.d.val, "D");
    });

    await t.step("12. Stateful: Relocking deep node completely severs upward chain", () => {
        class NewC implements IC {
            constructor(public d: ID) {}
            static [Cage.bond](c: Cage<[ID]>) {
                return new this(c.release(ID));
            }
        }
        using rootCage = deepRig.enclose();
        const overrideRig = rootCage.lock(IC, NewC);
        using cage = overrideRig.enclose();

        // @ts-expect-error: IA is dropped from the registry
        const captiveA = cage.release(IA);
        assertEquals(captiveA.b.c.d.val, "D");

        // @ts-expect-error: IB is dropped from the registry
        const captiveB = cage.release(IB);
        assertEquals(captiveB.c.d.val, "D");

        // IC is freshly bound, so this is fine:
        assertEquals(cage.release(IC).d.val, "D");
    });

    await t.step("13. Stateless: Pure branch override (tame) bypasses graph drop", () => {
        const statelessRig = deepRig.lock(ID, tame(() => ({ val: "StatelessD" })));
        using cage = statelessRig.enclose();

        // No TS errors! Dependents are strictly preserved.
        const a = cage.release(IA);
        assertEquals(a.b.c.d.val, "StatelessD");
    });

    await t.step("14. Harness: Cleanly relocking invalidated graphs", () => {
        class NewD implements ID {
            val = "NewD";
            static [Cage.bond]() {
                return new this();
            }
        }

        using rootCage = deepRig.enclose();
        // Harness lets us chain-relock the dropped nodes
        const safeRig = rootCage
            .lock(ID, NewD)
            .harness((r) => r.lock(IC, CImpl))
            .harness((r) => r.lock(IB, BImpl))
            .harness((r) => r.lock(IA, AImpl));

        using cage = safeRig.enclose();
        const a = cage.release(IA);
        assertEquals(a.b.c.d.val, "NewD");
    });

    await t.step("15. Harness: Applying sequential multi-plugin setup", () => {
        const pubRig = Rig.lock(ID, DImpl).harness((r) => r.lock(IEventBus, EventBus).lock(IPublisher, Publisher));
        const appRig = pubRig.harness((r) => r.lock(ISubscriber, Subscriber));

        using cage = appRig.enclose();
        assertInstanceOf(cage.release(ISubscriber), Subscriber);
    });

    // --- Section 4: Edge Cases & Error Handling ---

    await t.step("16. Errors: Unregistered base token throws exactly", () => {
        const rig = Rig.lock(ID, DImpl);
        using cage = rig.enclose();
        assertThrows(() => {
            // @ts-expect-error: Prevented at compile-time
            cage.release(IC);
        }, UnregisteredDependencyError);
    });

    await t.step("17. Errors: Unregistered transitive token throws with correct context", () => {
        abstract class ILoose {
            declare static readonly [Rig.token]: unique symbol;
        }
        class LooseDependent {
            static [Cage.bond](c: Cage<[ILoose]>) {
                c.release(ILoose);
                return new this();
            }
        }
        abstract class IDep {
            declare static readonly [Rig.token]: unique symbol;
        }

        // @ts-expect-error: LooseDependent requires ILoose, which is not provided in the registry
        const rig = Rig.lock(IDep, LooseDependent);
        using cage = rig.enclose();

        assertThrows(() => cage.release(IDep), UnregisteredDependencyError);
    });

    await t.step("18. Errors: Simple circular dependency throws CircularDependencyError", () => {
        const rig = Rig
            // @ts-expect-error: ICirc2 is not yet in the registry
            .lock(ICirc1, Circ1)
            // @ts-expect-error: ICirc3 is not yet in the registry
            .lock(ICirc2, Circ2)
            .lock(ICirc3, Circ3);

        using cage = rig.enclose();
        assertThrows(() => cage.release(ICirc1), CircularDependencyError);
    });

    await t.step("19. Errors: Deep circular dependency formatting trace", () => {
        const rig = Rig
            // @ts-expect-error: ICirc2 is not yet in the registry
            .lock(ICirc1, Circ1)
            // @ts-expect-error: ICirc3 is not yet in the registry
            .lock(ICirc2, Circ2)
            .lock(ICirc3, Circ3);

        using cage = rig.enclose();

        try {
            cage.release(ICirc1);

            // noinspection ExceptionCaughtLocallyJS
            throw new Error("Should not reach");
        } catch (e: unknown) {
            assertEquals((e as Error).message.includes("ICirc1 -> ICirc2 -> ICirc3 -> ICirc1"), true);
        }
    });

    await t.step("20. Errors: Self-referential loop throws cleanly", () => {
        // @ts-expect-error: SelfCirc requires ISelfCirc which isn't available yet
        const rig = Rig.lock(ISelfCirc, SelfCirc);
        using cage = rig.enclose();
        assertThrows(() => cage.release(ISelfCirc), CircularDependencyError);
    });

    await t.step("21. Errors: Optional dependency simulation via Catch block", () => {
        // @ts-expect-error: IOptionalTarget is deliberately omitted to test fallback behavior
        const rigWithout = Rig.lock(IOptionalConsumer, OptConsumer);
        using cageWithout = rigWithout.enclose();
        assertEquals(cageWithout.release(IOptionalConsumer).hasOpt, false);

        class PresentOpt implements IOptionalTarget {
            val = "Yes";
            static [Cage.bond]() {
                return new this();
            }
        }

        // NO @ts-expect-error needed here because IOptionalTarget is properly in the registry!
        const rigWith = Rig.lock(IOptionalTarget, PresentOpt).lock(IOptionalConsumer, OptConsumer);
        using cageWith = rigWith.enclose();
        assertEquals(cageWith.release(IOptionalConsumer).hasOpt, true);
    });

    // --- Section 5: Resource Management (Disposal) ---

    await t.step("22. Disposal: Synchronous exact triggering via[Symbol.dispose]", () => {
        disposalLog = [];
        {
            using cage = baseAppRig.enclose();
            cage.release(IDatabase);
        }
        assertEquals(disposalLog.includes("Database"), true);
    });

    await t.step("23. Disposal: Strict Reverse Topological (LIFO) cleanup order", () => {
        disposalLog = [];
        {
            using cage = baseAppRig.enclose();
            cage.release(IConnectionPool); // Also spins up IDatabase
        }
        assertEquals(disposalLog, ["ConnectionPool", "Database"]);
    });

    await t.step("24. Disposal: Child cage disposal explicitly preserves parent cache", () => {
        disposalLog = [];
        using parentCage = baseAppRig.enclose();
        parentCage.release(IDatabase);
        {
            using childCage = parentCage.lock(IConnectionPool, ConnectionPool).enclose();
            childCage.release(IConnectionPool);
        }
        // ConnectionPool dies, DB remains alive in parent cache!
        assertEquals(disposalLog, ["ConnectionPool"]);
    });

    await t.step("25. Disposal: Asynchronous lifecycle via await using", async () => {
        asyncDisposalLog = [];
        {
            await using cage = Rig.lock(IAsyncResource, AsyncResource).enclose();
            cage.release(IAsyncResource);
        }
        assertEquals(asyncDisposalLog, ["AsyncResource_Disposed"]);
    });

    await t.step("26. Disposal: Mixed resources prefer asyncDispose when awaited", async () => {
        asyncDisposalLog = [];
        {
            await using cage = Rig.lock(IMixedResource, MixedResource).lock(ISyncResource, SyncResource).enclose();
            cage.release(IMixedResource);
            cage.release(ISyncResource);
        }
        // LIFO Order: SyncResource instantiated last, disposed first.
        assertEquals(asyncDisposalLog, ["SyncResource_Disposed", "MixedResource_Async"]);
    });

    // --- Section 6: Real-World Architecture Scenarios ---

    await t.step("27. Real-World: Diamond Dependency singleton verification", () => {
        const rig = Rig.lock(IDiaBottom, DiaBottom).lock(IDiaLeft, DiaLeft).lock(IDiaRight, DiaRight).lock(IDiaTop, DiaTop);
        using cage = rig.enclose();
        const top = cage.release(IDiaTop);

        // The core requirement of the diamond problem: bottom is instantiated strictly once.
        assertStrictEquals(top.left.bottom, top.right.bottom);
    });

    await t.step("28. Real-World: Decoupled Pub/Sub via injected EventBus", () => {
        const rig = Rig.lock(IEventBus, EventBus).lock(IPublisher, Publisher).lock(ISubscriber, Subscriber);
        using cage = rig.enclose();

        const pub = cage.release(IPublisher);
        const sub = cage.release(ISubscriber);

        pub.publish("CRITICAL_SYSTEM_EVENT");
        assertEquals(sub.last(), "CRITICAL_SYSTEM_EVENT");
    });

    await t.step("29. Real-World: Resolving functional Factory Tokens", () => {
        abstract class IFactoryToken {
            declare static readonly [Rig.token]: unique symbol;
            abstract create(prefix: string): string;
        }
        const rig = Rig.lock(IFactoryToken, tame(() => ({ create: (p: string) => `${p}_Generated` })));

        using cage = rig.enclose();
        const factoryFn = cage.release(IFactoryToken);

        assertEquals(typeof factoryFn.create, "function");
        assertEquals(factoryFn.create("Test"), "Test_Generated");
    });

    await t.step("30. Real-World: Environment-based configuration swapping", () => {
        const isProd = false;
        const rig = Rig.lock(
            IConfig,
            isProd ? EnvConfig : tame(() => ({ service: "Config", dbUrl: "sqlite://memory" })),
        );

        using cage = rig.enclose();
        assertEquals(cage.release(IConfig).dbUrl, "sqlite://memory");
    });

    await t.step("31. Real-World: Safe multiple manual[Symbol.dispose]() calls", () => {
        disposalLog = [];
        const cage = baseAppRig.enclose();
        cage.release(IConnectionPool);

        cage[Symbol.dispose]();
        cage[Symbol.dispose](); // Idempotency check: should not throw or duplicate disposes

        assertEquals(disposalLog.length, 2);
    });

    await t.step("32. Real-World: Safe Reentrancy within boundary logic", () => {
        abstract class IManualRunner {
            declare static readonly [Rig.token]: unique symbol;
            abstract runInside(c: Cage<[ID]>): ID;
        }
        class ManualRunner implements IManualRunner {
            runInside(c: Cage<[ID]>) {
                return c.release(ID);
            }
            static [Cage.bond]() {
                return new this();
            }
        }

        const rig = Rig.lock(ID, DImpl).lock(IManualRunner, ManualRunner);
        using cage = rig.enclose();

        const runner = cage.release(IManualRunner);

        // @ts-expect-error: cage has the full registry, but runInside explicitly asks for Cage<[ID]>
        const nestedResult = runner.runInside(cage);

        assertEquals(nestedResult.val, "D");
    });
});

# Cage ⛓️

**A strict, zero-decorator, compile-time safe Dependency Injection container for TypeScript.**

**Cage** (published as `@kink/cage`) is a highly opinionated Dependency Injection (DI) framework built for modern TypeScript
(Deno/Node/Bun). It completely eliminates the "Captive Dependency" problem at compile-time, requires absolutely no `@Decorators`
or `reflect-metadata`, and perfectly respects modern ECMAScript Explicit Resource Management (`using`, `await using` /
`Symbol.dispose`, `Symbol.asyncDispose`).

Stop wrestling with string-token soup, async-initialization deadlocks, and silent scoping bugs. Tie your dependencies to the
**Rig**, lock them in a **Cage**, and safely **release** them exactly when you need them.

---

## 📦 Installation

Cage is published on [JSR](https://jsr.io/@kink/cage) under the `@kink` scope.

```bash
# Deno
deno add jsr:@kink/cage

# Node
npx jsr add @kink/cage

# Bun
bunx jsr add @kink/cage
```

---

## 🌟 Why Cage?

Traditional Dependency Injection approaches often face a few common architectural challenges:

1. **Captive Dependencies:** In hierarchical DI, if you override a `Database` token in a child container, resolving a
   `Controller` can accidentally yield the _root_ Controller holding the _root_ Database. Cage solves this via **advanced
   type-level graph invalidation**. If you override a stateful dependency, the compiler _forces_ you to re-bind its dependents.
2. **Decorator Magic:** Many solutions rely on experimental decorators and global reflection metadata. Cage uses purely standard
   ECMAScript and TypeScript without requiring `reflect-metadata` or compiler transforms. **The Token is the Type.**
3. **Async Spaghetti:** Mixing asynchronous logic directly into DI resolution can lead to non-deterministic startup sequences.
   Cage is strictly **synchronous**. It enforces a clean Two-Phase Initialization pattern (Wire synchronously, Boot
   asynchronously).

---

## 📖 The Cage Dictionary

Cage uses terminology that maps perfectly to standard Dependency Injection concepts, but makes your code incredibly memorable
and fun to read:

| Cage Term       | Standard DI Concept             | What it means in your code                                                                  |
| :-------------- | :------------------------------ | :------------------------------------------------------------------------------------------ |
| **`Rig`**       | `ContainerBuilder` / `Registry` | The immutable setup structure where you tie your dependencies together.                     |
| **`Cage`**      | `Container` / `Scope`           | The bounded execution context. It safely encloses your instantiated singletons.             |
| **`lock()`**    | `register()`                    | Tying an implementation to an interface/token on the Rig.                                   |
| **`bond`**      | `Factory` / `Provider`          | The static method defining the connection (the ropes) between a class and its dependencies. |
| **`release()`** | `resolve()` / `get()`           | Safely extracting an instantiated dependency out of the Cage.                               |
| **`tame()`**    | `toFactory()`                   | Subduing a raw custom factory function into a compliant bound object.                       |
| **`harness()`** | `apply()` / `configure()`       | Equipping or modifying a Rig with a batch of dependent graph re-locks or plugins.           |

---

## 🚀 Quick Start

### 1. Define your Contracts

Cage strictly uses abstract classes as injection tokens. The `[Rig.token]` symbol enforces pure nominal typing.

```typescript
import { Rig } from "@kink/cage";

abstract class IConfig {
    declare static readonly [Rig.token]: unique symbol;
    abstract get dbUrl(): string;
}

abstract class IDatabase {
    declare static readonly [Rig.token]: unique symbol;
    abstract connect(): void;
}
```

### 2. Create your Implementations

Use the `[Cage.bond]` symbol to tell Cage how to construct your classes. Notice how dependencies are cleanly requested using
standard instance types in a tuple (e.g., `Cage<[IConfig]>`)!

```typescript
import { Cage } from "@kink/cage";

class EnvConfig implements IConfig {
    get dbUrl() {
        return "postgres://prod";
    }

    // The bond tells the Cage how to instantiate this
    static [Cage.bond]() {
        return new this();
    }
}

class PostgresDB implements IDatabase {
    constructor(private config: IConfig) {}

    connect() {
        console.log(`Connected to ${this.config.dbUrl}`);
    }

    // Request your dependencies right from the Cage!
    static [Cage.bond](cage: Cage<[IConfig]>) {
        return new this(cage.release(IConfig));
    }
}
```

### 3. Tie the Rig and Release from the Cage

Build your dependency graph, enclose it, and run your app.

```typescript
import { Rig } from "@kink/cage";

// 1. Tie your tokens to their implementations on the Rig
const appRig = Rig
    .lock(IConfig, EnvConfig)
    .lock(IDatabase, PostgresDB);

// 2. Enclose the Rig into a runtime Cage
using appCage = appRig.enclose();

// 3. Release your fully wired dependencies!
const db = appCage.release(IDatabase);
db.connect();
```

---

## 🔥 Killer Features

### 1. Compile-Time "Captive Dependency" Protection

This is Cage's superpower. The type system knows the difference between a **Stateless Rig Branch** and a **Stateful Cage
Override**.

If you create a child `Cage` and override a stateful dependency, **TypeScript will refuse to compile** until you explicitly
re-bind everything that depended on it, entirely preventing captive scope leaks.

```typescript
import { tame } from "@kink/cage";

using rootCage = appRig.enclose();

// We override the Config for a specific test scope.
// Because it branches off a live Cage, it is a stateful override!
const testRig = rootCage.lock(IConfig, tame(() => new MockConfig()));
using testCage = testRig.enclose();

// 🚨 COMPILER ERROR: TS2345!
// Because IDatabase depends on IConfig, testCage dropped IDatabase
// from its type registry to prevent a captive dependency!
testCage.release(IDatabase);

// ✅ THE FIX: Explicitly relock the invalidated dependent graph via harness()
const safeTestRig = testRig.harness((rig) => rig.lock(IDatabase, PostgresDB));
using safeCage = safeTestRig.enclose();

// Works perfectly, safely returning a newly scoped Database!
safeCage.release(IDatabase);
```

_(Note: If you branch off a pure `Rig` instead of a `Cage`, the framework knows no instances have been cached yet and safely
preserves your dependents without throwing errors!)_

### 2. Tuple, Union, & Instance-Type Resolution

Cage's advanced type-inference engine lets you define dependencies naturally. No more wrapping everything in `typeof Token`
limits. Provide arrays, tuples, or union types mapping to pure instances:

```typescript
class WebController implements IController {
    constructor(public db: IDatabase, public logger: ILogger) {}

    // You can use a Tuple...
    static [Cage.bond](c: Cage<[IDatabase, ILogger]>) {
        return new this(c.release(IDatabase), c.release(ILogger));
    }

    // ...or a Union! Both are 100% type-safe.
    // static [Cage.bond](c: Cage<IDatabase | ILogger>)
}
```

### 3. Flawless Resource Management (`using` & `await using`)

Cage natively supports the standard `Disposable` and `AsyncDisposable` interfaces. When a `Cage` goes out of scope, it
automatically cleans up resources in strict reverse-instantiation order (LIFO).

```typescript
class PostgresDB implements IDatabase, AsyncDisposable {
    // ...
    async [Symbol.asyncDispose]() {
        console.log("Safely closing database connections...");
        await this.pool.end();
    }
}

{
    await using requestCage = requestRig.enclose();
    const db = requestCage.release(IDatabase);
    // Do work...
} // requestCage is destroyed here, and [Symbol.asyncDispose]() is instantly awaited!
```

### 4. Zero Dependencies & Tiny Footprint

Cage is written in purely standard TypeScript. It has **zero runtime dependencies**, requires absolutely no polyfills, uses no
experimental features, and comes entirely packaged in a single file footprint.

The internal resolution engine handles circular dependency tracking, registry invalidation, and parent-fallback mechanisms
without bloating your bundle.

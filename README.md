# Kink ⛓️

[![JSR](https://jsr.io/badges/@kink/cage)](https://jsr.io/@kink/cage)
[![TypeScript Strict](https://img.shields.io/badge/TypeScript-Strict-blue?logo=typescript)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **Brutally strict, compile-time safe backend utilities for modern TypeScript. No magic, just discipline.**

Kink is an ecosystem of highly opinionated, zero-decorator backend libraries for Deno, Node, and Bun. It is built on a simple
philosophy: **if your code is architecturally unsound, the TypeScript compiler should refuse to build it.**

We reject experimental decorators, reflection metadata, and implicit global states. Instead, we use advanced type-level
mechanics, strict scopes, and native ECMAScript features (like `using` / Explicit Resource Management) to force your application
into a flawless, deterministic structure.

Tie your stack together.

---

## 📦 The Ecosystem

Kink is built as a modular monorepo. You can use the packages independently, or combine them for an unyielding, strictly typed
full-stack framework.

| Package                         | Status     | Concept              | Description                                                                                                                                                                 |
| :------------------------------ | :--------- | :------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@kink/cage`](./packages/cage) | **Active** | Dependency Injection | A compile-time safe DI container that completely eliminates "Captive Dependencies" via type-level graph invalidation. Tie your bonds to the `Rig`, lock them in the `Cage`. |
| `@kink/whip`                    | _Planned_  | HTTP Router          | Fast, deterministic routing and middleware execution. Snappy request handling (`Strike`) and rigid error catching (`Flinch`).                                               |
| `@kink/collar`                  | _Planned_  | Auth & Guards        | Strict authorization boundaries. Restrict access based on roles (`Tags`) and track sessions (`Leashes`).                                                                    |
| `@kink/rope`                    | _Planned_  | Database ORM         | Type-safe relational query builder. Tie your data together with strict joins (`Knots`) and enforced foreign keys (`Binds`).                                                 |
| `@kink/blindfold`               | _Planned_  | Configuration        | Strict environment variable loading. Hide secrets from your main logic unless explicitly requested.                                                                         |

---

## ⚖️ Design Philosophy

1. **Zero Magic:** No `@Decorators` or `reflect-metadata`. The Token is the Type. Everything is traceable, explicitly imported,
   and heavily analyzed by the TypeScript compiler.
2. **Compile-Time Rejection:** Runtime errors for architectural mistakes are unacceptable. If you create a scoping issue or a
   captive dependency, Kink's types will intentionally break your build (`TS2345`) until you fix your architecture.
3. **Explicit Resource Management:** Native support for the standard `Disposable` and `AsyncDisposable` interfaces. When a
   context is destroyed, its resources are instantly and reliably cleaned up via the `using` keyword.

### A Taste of Discipline

Here is an example of Kink's compile-time rejection in action using `@kink/cage`. If you override a dependency for a specific
scope, the compiler intentionally drops any upstream classes that relied on the old state, preventing a Captive Dependency leak:

```typescript
using rootCage = appRig.enclose();

// Statefully overriding the Config drops the Database from the graph
const testRig = rootCage.lock(IConfig, tame(() => new MockConfig()));
using testCage = testRig.enclose();

// 🚨 COMPILER ERROR: TS2345
// "Argument of type 'typeof IDatabase' is not assignable to parameter of type 'never'."
// The framework forces you to explicitly re-bind the invalidated graph.
testCage.release(IDatabase);
```

---

## 🛠️ Development & Contributing

Kink is built as a Deno Workspace. To contribute or run tests across the entire ecosystem:

```bash
# Clone the repository
git clone https://github.com/anluin/kink.git
cd kink

# Run the strict type-checker and test suites across all packages
deno test --check

# Format and lint your code
deno fmt
deno lint
```

# fundgraph-core

`fundgraph-core` is the reusable, evidence-first TypeScript library for FundGraph.

It owns versioned domain models, dependency discovery, registry and repository adapters, funding evidence, relationship resolution, deterministic report models, and library tests. It must not own terminal UX, process exit codes, payment execution, or project-wide governance.

The project-level source of truth is in the sibling [`fundgraph`](../fundgraph/README.md) repository. The executable CLI is in [`fundgraph-cli`](../fundgraph-cli/README.md). The dependency direction is `fundgraph-cli` → `fundgraph-core` through a released package version.

## Current API

The package exports the versioned model types, `SCHEMA_VERSION`, `validateModel`, `validateModelSet`, `hasContradictoryRelationship`, `stableStringify`, `serializeModel`, `discoverDependencies`, `parseRegistryMetadata`, the discovery/metadata result types, and `FundGraphError`.

Validation rejects unsupported schema versions, unsafe credential-bearing or non-HTTP URLs, oversized fields, and invalid model shapes. Serialization sorts object keys while preserving array order.

`discoverDependencies(path)` supports npm (`package.json`/`package-lock.json`), PyPI (`pyproject.toml`/`requirements.txt` with `poetry.lock`), and Cargo (`Cargo.toml`/`Cargo.lock`). It preserves dependency source paths and locators, detects npm/Cargo workspaces, recognizes npm aliases and optional dependencies, emits transitive edges where lockfiles provide them, and returns diagnostics for missing or malformed lockfiles. It never executes project files.

`parseRegistryMetadata(ecosystem, payload, context)` normalizes recorded npm, PyPI, and crates.io responses into registry/package/repository models plus immutable evidence. Evidence retains the raw payload, source, parser, and observation timestamp. Sources are restricted to HTTPS allowlists for the relevant public registry, payloads are bounded, repository URLs are canonicalized, and malformed metadata produces diagnostics instead of guessed identity.

Phase 4 does not implement live network fetching, funding providers, relationship resolution, or final reports. Those belong to later roadmap phases.

Development commands:

```text
npm install
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

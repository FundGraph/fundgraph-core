# fundgraph-core

`fundgraph-core` is the reusable, evidence-first TypeScript library for FundGraph.

It will own versioned domain models, dependency discovery, registry and repository adapters, funding evidence, relationship resolution, deterministic report models, and library tests. It must not own terminal UX, process exit codes, payment execution, or project-wide governance.

The project-level source of truth is in the sibling [`fundgraph`](../fundgraph/README.md) repository. The executable CLI is in [`fundgraph-cli`](../fundgraph-cli/README.md). The dependency direction is `fundgraph-cli` → `fundgraph-core` through a released package version.

## Phase 1 API

The package exports the versioned model types, `SCHEMA_VERSION`, `validateModel`, `validateModelSet`, `hasContradictoryRelationship`, `stableStringify`, `serializeModel`, and `FundGraphError`. Validation rejects unsupported schema versions, unsafe credential-bearing or non-HTTP URLs, oversized fields, and invalid model shapes. Serialization sorts object keys while preserving array order.

Phase 1 does not implement dependency discovery, registry adapters, funding providers, reports, or CLI behavior. Those belong to later roadmap phases.

Development commands:

```text
npm install
npm run typecheck
npm test
npm run build
npm pack --dry-run
```


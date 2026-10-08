# fundgraph-core

`fundgraph-core` is the reusable, evidence-first TypeScript library for FundGraph.

It owns versioned domain models, dependency discovery, registry and repository adapters, funding evidence, relationship resolution, deterministic report models, and library tests. It must not own terminal UX, process exit codes, payment execution, or project-wide governance.

The project-level source of truth is in the sibling [`fundgraph`](../fundgraph/README.md) repository. The executable CLI is in [`fundgraph-cli`](../fundgraph-cli/README.md). The dependency direction is `fundgraph-cli` → `fundgraph-core` through a released package version.

## Current API

The package exports the versioned model types, `SCHEMA_VERSION`, `validateModel`, `validateModelSet`, `hasContradictoryRelationship`, `stableStringify`, `serializeModel`, `discoverDependencies`, `parseRegistryMetadata`, `resolveFundingRelationships`, `createReport`, `renderReportText`, `renderReportJson`, `NetworkClient`, `fetchJson`, `fetchJsonBatch`, `validateNetworkUrl`, `invalidateCache`, the discovery/metadata/report/network result types, and `FundGraphError`.

Validation rejects unsupported schema versions, unsafe credential-bearing or non-HTTP URLs, oversized fields, and invalid model shapes. Serialization sorts object keys while preserving array order.

`discoverDependencies(path)` supports npm (`package.json`/`package-lock.json`), PyPI (`pyproject.toml`/`requirements.txt` with `poetry.lock`), and Cargo (`Cargo.toml`/`Cargo.lock`). It preserves dependency source paths and locators, detects npm/Cargo workspaces, recognizes npm aliases and optional dependencies, emits transitive edges where lockfiles provide them, and returns diagnostics for missing or malformed lockfiles. It never executes project files.

`parseRegistryMetadata(ecosystem, payload, context)` normalizes recorded npm, PyPI, and crates.io responses into registry/package/repository models plus immutable evidence. Evidence retains the raw payload, source, parser, and observation timestamp. Sources are restricted to HTTPS allowlists for the relevant public registry, payloads are bounded, repository URLs are canonicalized, and malformed metadata produces diagnostics instead of guessed identity.

Funding evidence is collected with `parsePackageFundingMetadata`, `parseGithubFundingFile`, and `parsePublicFundingResponse`. Every emitted `FundingSource` has evidence IDs. Multiple declarations remain separate, unsafe URLs and malformed files produce diagnostics, and provider responses never become authoritative identity claims. These functions consume recorded/local payloads; they do not send money or execute payments.

`resolveFundingRelationships(input)` consumes packages, repositories, funding sources, evidence, repository candidates, and explicit funding claims. It emits deterministic `Relationship` records with rule IDs, evidence IDs, confidence, and `supported`, `ambiguous`, `contradictory`, or `unresolved` status. It never infers a person’s identity or selects one of several conflicting sources.

`createReport(input)` emits a schema-versioned `FundGraphReport` with deterministic record ordering, relationship status summaries, evidence drill-down, diagnostics, explicit limitations, and informational review/inspect actions. `renderReportText` is terminal-safe and `renderReportJson` supports compact stable JSON or readable pretty JSON. Reports do not verify identity, endorse funding destinations, or execute actions.

`NetworkClient` is the opt-in reliability boundary for live JSON requests. It provides typed timeout, cancellation, network, rate-limit, and cache errors; bounded retries with `Retry-After` and capped backoff; injected fetch/sleep/clock dependencies for deterministic tests; filesystem caching with TTL and explicit invalidation; offline replay; and `jsonBatch` partial-result semantics. Authenticated requests cannot be cached, and stale offline responses are returned only with a `CACHE_STALE` diagnostic.

Secure defaults require public credential-free HTTPS, reject private/loopback/local destinations and redirects, and cap response bodies at 1 MiB by default (with a hard 8 MiB ceiling). Callers needing provider-specific routing must provide an explicit host allowlist; DNS resolution and network isolation remain deployment responsibilities.

The fixture matrix is in `test/fixtures/integration/fixture-matrix.json`. `test/integration.test.js` runs the complete discovery-to-report pipeline for npm, PyPI, and Cargo and checks funded, unfunded, ambiguous, contradictory, missing-repository, malformed-lockfile, rate-limit, and network-failure categories.

Development commands:

```text
npm install
npm run lint
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

Contributor guidance for adapters and recorded fixtures is maintained in the sibling [`fundgraph` adapter guide](../fundgraph/docs/ADAPTER_GUIDE.md).

The repository CI workflow verifies Ubuntu, Windows, and macOS on Node 20 and Node 22, then uploads a package artifact after the checks pass.

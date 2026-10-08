# Contributing to fundgraph-core

Read the sibling `fundgraph` repository's `PROJECT_CONTEXT.md`, `ROADMAP.md`, `docs/CONTRIBUTOR_GUIDE.md`,
`docs/ADAPTER_GUIDE.md`, and `docs/COMPATIBILITY_POLICY.md` before changing library behavior.

Core changes must preserve deterministic output, explicit evidence, secure input handling, and the dependency direction
`fundgraph-cli` → `fundgraph-core`. Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` before review.
Use recorded fixtures instead of live network calls. New adapters require success and failure fixtures plus a compatibility
and security review.

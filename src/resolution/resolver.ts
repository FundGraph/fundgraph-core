import type { Confidence, Evidence, FundingSource, Package, Relationship, Repository } from '../domain/models.js';
import type { FundingClaim, RepositoryCandidate, ResolutionInput, ResolutionResult } from './types.js';

function confidence(level: Confidence['level'], rationale: string, evidenceIds: string[]): Confidence {
  return {
    schemaVersion: '1.0',
    kind: 'Confidence',
    id: `confidence:${level}:${encodeURIComponent(rationale)}`,
    level,
    rationale,
    evidenceIds: [...new Set(evidenceIds)].sort(),
  };
}

function relationshipId(type: Relationship['type'], fromId: string, toId: string, ruleId: string): string {
  return `relationship:${type}:${encodeURIComponent(`${fromId}:${toId}:${ruleId}`)}`;
}

function relationship(
  type: Relationship['type'],
  fromId: string,
  toId: string,
  ruleId: string,
  status: Relationship['status'],
  level: Confidence['level'],
  rationale: string,
  evidenceIds: string[],
): Relationship {
  const uniqueEvidence = [...new Set(evidenceIds)].sort();
  return {
    schemaVersion: '1.0',
    kind: 'Relationship',
    id: relationshipId(type, fromId, toId, ruleId),
    type,
    fromId,
    toId,
    confidence: confidence(level, rationale, uniqueEvidence),
    evidenceIds: uniqueEvidence,
    ruleId,
    status,
  };
}

function packageCandidates(pkg: Package, repositories: Map<string, Repository>, candidates: RepositoryCandidate[]): RepositoryCandidate[] {
  const explicit = candidates.filter((candidate) => candidate.packageId === pkg.id && repositories.has(candidate.repositoryId));
  if (explicit.length > 0) return explicit;
  if (pkg.repositoryId && repositories.has(pkg.repositoryId)) return [{ packageId: pkg.id, repositoryId: pkg.repositoryId, evidenceIds: pkg.evidenceIds, ruleId: 'package.repositoryId' }];
  return [];
}

export function resolveFundingRelationships(input: ResolutionInput): ResolutionResult {
  const repositories = new Map(input.repositories.map((item) => [item.id, item]));
  const fundingSources = new Map(input.fundingSources.map((item) => [item.id, item]));
  const evidence = new Map((input.evidence ?? []).map((item) => [item.id, item]));
  const candidates = input.repositoryCandidates ?? [];
  const claims = input.fundingClaims ?? [];
  const relationships: Relationship[] = [];
  const diagnostics: string[] = [];

  for (const pkg of [...input.packages].sort((a, b) => a.id.localeCompare(b.id))) {
    const allCandidates = candidates.filter((candidate) => candidate.packageId === pkg.id);
    const usableCandidates = packageCandidates(pkg, repositories, candidates);
    const candidateIds = [...new Set(allCandidates.map((candidate) => candidate.repositoryId))];
    if (candidateIds.length > 1) {
      for (const candidate of allCandidates.sort((a, b) => a.repositoryId.localeCompare(b.repositoryId))) {
        relationships.push(relationship('package-repository', pkg.id, candidate.repositoryId, candidate.ruleId, 'ambiguous', 'unknown', 'Multiple repository candidates were declared; no candidate was selected.', [...pkg.evidenceIds, ...candidate.evidenceIds]));
      }
      diagnostics.push(`Package ${pkg.id} has conflicting repository candidates`);
      continue;
    }
    if (allCandidates.length > 0 && usableCandidates.length === 0) {
      relationships.push(relationship('package-repository', pkg.id, allCandidates[0]!.repositoryId, allCandidates[0]!.ruleId, 'contradictory', 'unknown', 'A declared repository candidate was not present in the repository set.', [...pkg.evidenceIds, ...allCandidates[0]!.evidenceIds]));
      diagnostics.push(`Package ${pkg.id} has a repository candidate with no matching repository`);
      continue;
    }
    if (usableCandidates.length === 0) {
      relationships.push(relationship('package-repository', pkg.id, pkg.repositoryId ?? `unresolved:${pkg.id}`, 'package.repositoryId', 'unresolved', 'unknown', 'No usable repository identity was available for this package.', pkg.evidenceIds));
      continue;
    }
    const candidate = usableCandidates[0]!;
    const repo = repositories.get(candidate.repositoryId)!;
    const compatibleEvidence = [...pkg.evidenceIds, ...repo.evidenceIds, ...candidate.evidenceIds];
    const corroborated = new Set(compatibleEvidence).size >= 2;
    relationships.push(relationship('package-repository', pkg.id, repo.id, candidate.ruleId, 'supported', corroborated ? 'high' : 'medium', corroborated ? 'Package and repository metadata provide compatible evidence.' : 'A direct package-to-repository declaration supports this relationship.', compatibleEvidence));
  }

  for (const claim of [...claims].sort((a, b) => `${a.repositoryId}:${a.fundingSourceId}`.localeCompare(`${b.repositoryId}:${b.fundingSourceId}`))) {
    const repo = repositories.get(claim.repositoryId);
    const source = fundingSources.get(claim.fundingSourceId);
    if (!repo || !source) {
      relationships.push(relationship('repository-funding', claim.repositoryId, claim.fundingSourceId, claim.ruleId, 'contradictory', 'unknown', 'A funding claim references an entity missing from the resolution input.', claim.evidenceIds));
      diagnostics.push(`Funding claim ${claim.repositoryId} → ${claim.fundingSourceId} references missing entities`);
      continue;
    }
    relationships.push(relationship('repository-funding', repo.id, source.id, claim.ruleId, 'supported', claim.evidenceIds.length > 1 ? 'high' : 'medium', claim.evidenceIds.length > 1 ? 'An explicit funding declaration has corroborating evidence.' : 'An explicit funding declaration connects the repository and funding source.', [...repo.evidenceIds, ...source.evidenceIds, ...claim.evidenceIds]));
  }

  const knownClaimPairs = new Set(claims.map((claim) => `${claim.repositoryId}:${claim.fundingSourceId}`));
  for (const claim of claims) {
    if (!repositories.has(claim.repositoryId) || !fundingSources.has(claim.fundingSourceId)) continue;
    for (const other of claims) {
      if (other.repositoryId === claim.repositoryId && other.fundingSourceId !== claim.fundingSourceId && knownClaimPairs.has(`${other.repositoryId}:${other.fundingSourceId}`)) {
        const existing = relationships.find((item) => item.type === 'repository-funding' && item.fromId === claim.repositoryId && item.toId === claim.fundingSourceId && item.ruleId === claim.ruleId);
        if (existing) {
          existing.status = 'ambiguous';
          existing.confidence = confidence('unknown', 'Multiple funding sources were explicitly declared for the same repository; this resolver does not select one.', existing.evidenceIds);
        }
      }
    }
  }

  relationships.sort((a, b) => a.id.localeCompare(b.id));
  return { relationships, diagnostics: [...new Set(diagnostics)].sort() };
}


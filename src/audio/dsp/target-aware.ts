import type { AnalysisTarget } from "../frame-protocol";

const TARGET_SEARCH_CENTS = 140;
const TARGET_MAX_CMNDF = 0.45;
const RAW_RELATION_MAX_CENTS = 45;
const MAX_HARMONIC_RELATION = 4;
const PROFILE_FLOOR_DB = -180;

export interface TargetAwarePitchInput {
  rawHz: number;
  rawConfidence: number;
  rawCmndAtTau: number;
  cmnd: ArrayLike<number>;
  sampleRate: number;
  targets: readonly AnalysisTarget[];
  profileScores: Readonly<Record<string, number>>;
}

export interface TargetAwarePitchResult {
  hz: number;
  confidence: number;
  cmndAtTau: number;
  targetId: string | null;
  relation: "direct" | "harmonic" | "subharmonic" | null;
  relationMultiple: number | null;
}

function centsBetween(hz: number, referenceHz: number): number {
  return 1200 * Math.log2(hz / referenceHz);
}

function parabolicTau(d: ArrayLike<number>, tau: number): number {
  const t = tau | 0;
  if (t <= 0 || t >= d.length - 1) return tau;
  const s0 = d[t - 1] ?? 0;
  const s1 = d[t] ?? 0;
  const s2 = d[t + 1] ?? 0;
  const denom = s0 + s2 - 2 * s1;
  if (denom === 0) return tau;
  return t + (s0 - s2) / (2 * denom);
}

function localTargetPitch(cmnd: ArrayLike<number>, sampleRate: number, targetHz: number) {
  const centerTau = sampleRate / targetHz;
  const minTau = Math.max(2, Math.floor(centerTau * 2 ** (-TARGET_SEARCH_CENTS / 1200)));
  const maxTau = Math.min(cmnd.length - 2, Math.ceil(centerTau * 2 ** (TARGET_SEARCH_CENTS / 1200)));
  if (maxTau <= minTau) return null;

  let bestTau = minTau;
  let bestValue = cmnd[minTau] ?? 1;
  for (let tau = minTau + 1; tau <= maxTau; tau += 1) {
    const value = cmnd[tau] ?? 1;
    if (value < bestValue) {
      bestValue = value;
      bestTau = tau;
    }
  }
  if (bestValue > TARGET_MAX_CMNDF) return null;

  const refinedTau = parabolicTau(cmnd, bestTau);
  const hz = refinedTau > 0 ? sampleRate / refinedTau : 0;
  if (hz <= 0) return null;

  return {
    hz,
    cmndAtTau: bestValue,
    confidence: Math.max(0, Math.min(1, 1 - bestValue)),
  };
}

function rawRelation(rawHz: number, candidateHz: number, targetHz: number) {
  if (rawHz <= 0 || candidateHz <= 0) return null;
  if (rawHz >= candidateHz) {
    const harmonic = Math.max(1, Math.round(rawHz / candidateHz));
    if (harmonic > MAX_HARMONIC_RELATION) return null;
    const cents = Math.abs(centsBetween(rawHz, candidateHz * harmonic));
    if (cents > RAW_RELATION_MAX_CENTS) return null;
    const lowString = targetHz < 100;
    const penalty = harmonic === 1 ? 0 : lowString ? 35 + (harmonic - 2) * 10 : 22 + (harmonic - 2) * 12;
    return {
      kind: harmonic === 1 ? "direct" as const : "harmonic" as const,
      multiple: harmonic,
      cents,
      penalty,
    };
  }

  const subharmonic = Math.round(candidateHz / rawHz);
  if (subharmonic < 2 || subharmonic > MAX_HARMONIC_RELATION) return null;
  const cents = Math.abs(centsBetween(rawHz * subharmonic, candidateHz));
  if (cents > RAW_RELATION_MAX_CENTS) return null;
  return {
    kind: "subharmonic" as const,
    multiple: subharmonic,
    cents,
    penalty: 20 + (subharmonic - 2) * 12,
  };
}

export function resolveTargetAwarePitch(input: TargetAwarePitchInput): TargetAwarePitchResult {
  if (input.rawHz <= 0 || input.targets.length === 0) {
    return {
      hz: input.rawHz,
      confidence: input.rawConfidence,
      cmndAtTau: input.rawCmndAtTau,
      targetId: null,
      relation: null,
      relationMultiple: null,
    };
  }

  const bestProfileScore = input.targets.reduce(
    (best, target) => Math.max(best, input.profileScores[target.id] ?? PROFILE_FLOOR_DB),
    PROFILE_FLOOR_DB,
  );

  const candidates: Array<TargetAwarePitchResult & { score: number; profileScore: number; targetHz: number }> = [];
  for (const target of input.targets) {
    const localCandidate = localTargetPitch(input.cmnd, input.sampleRate, target.hz);
    const rawTargetCents = centsBetween(input.rawHz, target.hz);
    const pitchCandidates = [
      localCandidate,
      Math.abs(rawTargetCents) <= TARGET_SEARCH_CENTS
        ? {
            hz: input.rawHz,
            cmndAtTau: input.rawCmndAtTau,
            confidence: input.rawConfidence,
          }
        : null,
    ];

    for (const candidate of pitchCandidates) {
      if (!candidate) continue;
      const targetCents = centsBetween(candidate.hz, target.hz);
      if (Math.abs(targetCents) > TARGET_SEARCH_CENTS) continue;

      const relation = rawRelation(input.rawHz, candidate.hz, target.hz);
      if (!relation) continue;

      const profileScore = input.profileScores[target.id] ?? PROFILE_FLOOR_DB;
      const profileDeficit = Math.max(0, bestProfileScore - profileScore);
      const score =
        Math.abs(targetCents) +
        relation.penalty +
        relation.cents * 0.5 +
        profileDeficit * 4 +
        candidate.cmndAtTau * 35;

      candidates.push({
        hz: candidate.hz,
        confidence: candidate.confidence,
        cmndAtTau: candidate.cmndAtTau,
        targetId: target.id,
        relation: relation.kind,
        relationMultiple: relation.multiple,
        score,
        profileScore,
        targetHz: target.hz,
      });
    }
  }

  const direct = candidates
    .filter((candidate) => candidate.relation === "direct")
    .sort((a, b) => a.score - b.score)[0];
  const strongestNonDirect = candidates
    .filter((candidate) => candidate.relation !== "direct")
    .sort((a, b) => a.score - b.score)[0];
  const harmonicOverride =
    direct &&
    strongestNonDirect &&
    strongestNonDirect.score + 12 <= direct.score;
  const eligible = harmonicOverride && strongestNonDirect ? [strongestNonDirect] : direct ? [direct] : candidates;
  const best = eligible.sort((a, b) => a.score - b.score)[0] ?? null;

  if (best) {
    const { score: _score, profileScore: _profileScore, targetHz: _targetHz, ...result } = best;
    return result;
  }

  return {
    hz: input.rawHz,
    confidence: input.rawConfidence,
    cmndAtTau: input.rawCmndAtTau,
    targetId: null,
    relation: null,
    relationMultiple: null,
  };
}

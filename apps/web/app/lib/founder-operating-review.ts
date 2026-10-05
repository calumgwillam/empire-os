import {
  compareIcarusExposure,
  type IcarusExposureSnapshotEntry,
  type IcarusExposureTrajectory,
} from "./icarus-exposure-history";
import type { IcarusAssessmentStatus } from "./icarus";

export type FounderOperatingReviewSnapshot = {
  date: string;
  ownershipGapCount: number;
  decisionReviewsDue: number;
  executionGapCount: number;
  learningGapCount: number;
  staleRecordCount: number;
  financeAttentionCount: number;
  growthStallCount: number;
  availableOperatingCash: number | null;
  delegationQualityPct?: number | null;
  selfSufficiencyPct?: number | null;
  outstandingKeys?: readonly {
    key: string;
    title: string;
    objectType: string;
    category: string;
  }[];
  // Absent on snapshots recorded before Icarus history existed.
  icarusExposure?: readonly IcarusExposureSnapshotEntry[];
};

export type FounderOperatingReviewNavigation =
  | { type: "record"; objectType: string; id: string }
  | { type: "unassigned" }
  | { type: "watch"; index: number };

export type FounderOperatingReviewItem = {
  id: string;
  objectType: string;
  title: string;
  area?: string;
  why: string;
  navigation: FounderOperatingReviewNavigation;
};

export type FounderOperatingReviewInput = {
  todaySnapshotDate: string;
  snapshots: readonly FounderOperatingReviewSnapshot[];
  todayBrief: {
    ownershipGapCount: number;
    reviewDueCount: number;
    executionGapCount: number;
    learningGapCount: number;
    staleCount: number;
    financeCount: number;
    growthStallCount: number;
    outstandingKeys: readonly {
      key: string;
      title: string;
      objectType: string;
      category: string;
    }[];
  };
  selfSufficiencyPct: number | null;
  delegationQualityPct: number | null;
  cashIsConfigured: boolean;
  availableOperatingCash: number | null;
  topOwnerShare: number | null;
  delegateItemCount: number;
  unresolvedRecurring: readonly {
    id: string;
    problemStatement: string;
    title: string;
    area: string;
    frequency: string;
    severity: string;
  }[];
  convergentRisks: readonly {
    clusterKey: string;
    title: string;
    categoryCount: number;
    recordCount: number;
    root: { id: string; objectType: string; area: string };
    strategicRisks?: readonly { assessmentId: string; outcome: string; exposure: string }[];
  }[];
  focusCandidates: readonly {
    key: string;
    objectType: string;
    id: string;
    title: string;
    area: string;
    reason: string;
  }[];
  unassignedCarriedCount: number;
  founderReviewQueue: readonly {
    kind: string;
    id: string;
    title: string;
    pillar: string;
    reasonCategory: string;
    whyItMatters: string;
  }[];
  watch: readonly {
    id: string;
    objectType: string;
    title: string;
    area: string;
    why: string;
    sourceIndex: number;
  }[];
  icarusExposure?: {
    current: readonly IcarusExposureSnapshotEntry[];
    assessmentStatuses: ReadonlyMap<string, IcarusAssessmentStatus>;
  };
};

export type FounderOperatingReviewResult = {
  headline: string;
  hasSufficientHistory: boolean;
  snapshotCount: number;
  baselineDateLabel: string;
  improved: { metric: string; changeText: string; explanation: string }[];
  deteriorated: { metric: string; changeText: string; explanation: string }[];
  recurring: FounderOperatingReviewItem[];
  founderDependency: { status: string; summary: string; detail: string };
  next7Days: FounderOperatingReviewItem[];
  strategicRiskTrajectory: IcarusExposureTrajectory | null;
};

export function buildFounderOperatingReview(
  input: FounderOperatingReviewInput,
): FounderOperatingReviewResult {
  const earlierSnapshots = input.snapshots
    .filter((entry) => entry.date < input.todaySnapshotDate)
    .sort((a, b) => a.date.localeCompare(b.date));

  const hasSufficientHistory = earlierSnapshots.length >= 1;
  const baselineSnapshot = earlierSnapshots.slice(-7)[0] || null;
  const baselineDateLabel = baselineSnapshot ? baselineSnapshot.date : input.todaySnapshotDate;

  const improved: FounderOperatingReviewResult["improved"] = [];
  const deteriorated: FounderOperatingReviewResult["deteriorated"] = [];

  if (baselineSnapshot) {
    const compareLowerIsBetter = (
      metric: string,
      currentVal: number,
      baseVal: number,
      improvedExplanation: string,
      deterioratedExplanation: string,
    ) => {
      if (currentVal < baseVal) {
        const diff = baseVal - currentVal;
        improved.push({
          metric,
          changeText: `${baseVal} → ${currentVal} (-${diff})`,
          explanation: improvedExplanation,
        });
      } else if (currentVal > baseVal) {
        const diff = currentVal - baseVal;
        deteriorated.push({
          metric,
          changeText: `${baseVal} → ${currentVal} (+${diff})`,
          explanation: deterioratedExplanation,
        });
      }
    };

    const compareHigherIsBetter = (
      metric: string,
      currentVal: number | null | undefined,
      baseVal: number | null | undefined,
      improvedExplanation: string,
      deterioratedExplanation: string,
      unit = "",
    ) => {
      if (currentVal == null || baseVal == null) return;
      if (currentVal > baseVal) {
        const diff = currentVal - baseVal;
        improved.push({
          metric,
          changeText: `${baseVal}${unit} → ${currentVal}${unit} (+${diff}${unit})`,
          explanation: improvedExplanation,
        });
      } else if (currentVal < baseVal) {
        const diff = baseVal - currentVal;
        deteriorated.push({
          metric,
          changeText: `${baseVal}${unit} → ${currentVal}${unit} (-${diff}${unit})`,
          explanation: deterioratedExplanation,
        });
      }
    };

    compareLowerIsBetter("Ownership gaps", input.todayBrief.ownershipGapCount, baselineSnapshot.ownershipGapCount,
      "Fewer unassigned or ghost-owned active work items require founder triage.",
      "More active items now lack a valid active owner.");
    compareLowerIsBetter("Decision reviews due", input.todayBrief.reviewDueCount, baselineSnapshot.decisionReviewsDue,
      "Pending decision reviews were completed or updated.",
      "More decisions have reached or passed their scheduled review date without closure.");
    compareLowerIsBetter("Execution gaps", input.todayBrief.executionGapCount, baselineSnapshot.executionGapCount,
      "Active decisions were connected to open actions or projects.",
      "More active decisions currently lack an execution path.");
    compareLowerIsBetter("Learning gaps", input.todayBrief.learningGapCount, baselineSnapshot.learningGapCount,
      "Recurring problems were converted into lessons, systems or SOPs.",
      "Recurring problems remain uncaptured as learning.");
    compareLowerIsBetter("Stale records", input.todayBrief.staleCount, baselineSnapshot.staleRecordCount,
      "Active records received status movement or review.",
      "More active records have gone without movement or review.");
    compareLowerIsBetter("Finance attention", input.todayBrief.financeCount, baselineSnapshot.financeAttentionCount,
      "Finance attention items were resolved.",
      "More finance attention items (buffer pressure / overdue commitments / income) emerged.");
    compareLowerIsBetter("Growth stalls", input.todayBrief.growthStallCount, baselineSnapshot.growthStallCount,
      "Commercial leads or high-fit opportunities were progressed.",
      "More high-fit opportunities or commercial leads have gone idle.");
    compareHigherIsBetter("Ownership outside primary Founder", input.selfSufficiencyPct, baselineSnapshot.selfSufficiencyPct,
      "Non-founder owners are carrying a larger share of active operational work.",
      "Founder is carrying a larger share of active operational work.", "%");
    compareHigherIsBetter("Delegation quality", input.delegationQualityPct, baselineSnapshot.delegationQualityPct,
      "Work distribution and delegation structure across active owners improved.",
      "Delegation structure or workload concentration worsened.", "%");
    compareHigherIsBetter("Operating cash",
      input.cashIsConfigured ? input.availableOperatingCash : null,
      baselineSnapshot.availableOperatingCash,
      "Available operating cash balance increased.",
      "Available operating cash balance decreased.");
  }

  const strategicRiskTrajectory = input.icarusExposure
    ? compareIcarusExposure({
      previous: baselineSnapshot?.icarusExposure,
      current: input.icarusExposure.current,
      assessmentStatuses: input.icarusExposure.assessmentStatuses,
    })
    : null;
  if (strategicRiskTrajectory?.hasBaseline) {
    // Reported per change kind so churn (one new, one resolved) is never hidden by an unchanged net count.
    const outcomes = (kind: string) => strategicRiskTrajectory.changes
      .filter((change) => change.change === kind)
      .map((change) => change.outcome)
      .join("; ");
    const { counts } = strategicRiskTrajectory;
    if (counts.New > 0) {
      deteriorated.push({
        metric: "New strategic risks",
        changeText: `+${counts.New} material Icarus exposure${counts.New === 1 ? "" : "s"}`,
        explanation: `Newly material Icarus exposure: ${outcomes("New")}.`,
      });
    }
    if (counts.Worsened > 0) {
      deteriorated.push({
        metric: "Strategic risk severity",
        changeText: `${counts.Worsened} worsened`,
        explanation: `Icarus exposure moved to a more severe tier, gained an exposed failure mode or rose in strategic consequence: ${outcomes("Worsened")}.`,
      });
    }
    if (counts.Resolved > 0) {
      improved.push({
        metric: "Resolved strategic risks",
        changeText: `-${counts.Resolved} material Icarus exposure${counts.Resolved === 1 ? "" : "s"}`,
        explanation: `Icarus exposure was closed or is no longer material: ${outcomes("Resolved")}.`,
      });
    }
    if (counts.Improved > 0) {
      improved.push({
        metric: "Strategic risk severity",
        changeText: `${counts.Improved} improved`,
        explanation: `Icarus exposure moved to a less severe tier, lost exposed failure modes or fell in strategic consequence: ${outcomes("Improved")}.`,
      });
    }
  }
  if (strategicRiskTrajectory?.hasAssuranceBaseline) {
    // Assurance changes are separate from exposure changes: a risk can be equally exposed but less (or more) assured.
    const assuranceOutcomes = (kind: string) => strategicRiskTrajectory.assuranceChanges
      .filter((change) => change.change === kind)
      .map((change) => change.outcome)
      .join("; ");
    const counts = strategicRiskTrajectory.assuranceCounts;
    const deterioratedKinds = [
      ["Assurance deteriorated", "Strategic risk assurance", "weaker", "Assurance weakened (failed, overdue or unverified controls): "],
      ["Acceptance expired", "Accepted strategic exposure", "expired", "Accepted exposure passed its review date without the mechanism being removed: "],
      ["Owner removed", "Strategic risk ownership", "owner removed", "Material strategic risk lost its accountable owner: "],
    ] as const;
    const improvedKinds = [
      ["Assurance improved", "Strategic risk assurance", "stronger", "Assurance strengthened by tested, evidenced controls: "],
      ["Failed control remediated", "Failed controls remediated", "remediated", "A previously failing control is no longer failing: "],
      ["Owner assigned", "Strategic risk ownership", "owner assigned", "Material strategic risk now has an accountable owner: "],
      ["Acceptance created", "Accepted strategic exposure", "accepted", "Exposure formally accepted with a rationale and review date: "],
    ] as const;
    deterioratedKinds.forEach(([kind, metric, text, prefix]) => {
      if (counts[kind] > 0) deteriorated.push({ metric, changeText: `${counts[kind]} ${text}`, explanation: `${prefix}${assuranceOutcomes(kind)}.` });
    });
    improvedKinds.forEach(([kind, metric, text, prefix]) => {
      if (counts[kind] > 0) improved.push({ metric, changeText: `${counts[kind]} ${text}`, explanation: `${prefix}${assuranceOutcomes(kind)}.` });
    });
  }

  const recurring: FounderOperatingReviewItem[] = [];
  const usedRecurringKeys = new Set<string>();

  input.unresolvedRecurring.forEach((problem) => {
    const key = `Problem:${problem.id}`;
    if (usedRecurringKeys.has(key)) return;
    recurring.push({
      id: problem.id,
      objectType: "Problem",
      title: problem.problemStatement || problem.title,
      area: problem.area,
      why: `${problem.frequency} problem (${problem.severity.toLowerCase()} severity) — needs captured learning or SOP`,
      navigation: { type: "record", objectType: "Problem", id: problem.id },
    });
    usedRecurringKeys.add(key);
  });

  input.convergentRisks.forEach((cluster) => {
    if (recurring.length >= 3) return;
    if (usedRecurringKeys.has(cluster.clusterKey)) return;
    const root = cluster.root;
    recurring.push({
      id: root.id,
      objectType: root.objectType,
      title: cluster.title,
      area: root.area,
      why: `Convergent risk generating ${cluster.categoryCount} signal categories across ${cluster.recordCount} linked records${cluster.strategicRisks && cluster.strategicRisks.length > 0
        ? `; Icarus: ${cluster.strategicRisks.map((risk) => `${risk.exposure.toLowerCase()} in "${risk.outcome}"`).join("; ")}`
        : ""}`,
      navigation: { type: "record", objectType: root.objectType, id: root.id },
    });
    usedRecurringKeys.add(cluster.clusterKey);
  });

  if (baselineSnapshot?.outstandingKeys) {
    const baselineKeysSet = new Set(baselineSnapshot.outstandingKeys.map((item) => item.key));
    input.todayBrief.outstandingKeys.forEach((item) => {
      if (recurring.length >= 3) return;
      if (baselineKeysSet.has(item.key) && !usedRecurringKeys.has(item.key)) {
        const keyParts = item.key.split(":");
        const objectType = item.objectType || keyParts[0] || "Record";
        const recordId = keyParts.slice(1).join(":");
        recurring.push({
          id: recordId || item.key,
          objectType,
          title: item.title,
          why: `Unresolved attention item persisting across posture snapshots (${item.category})`,
          navigation: { type: "record", objectType, id: recordId || item.key },
        });
        usedRecurringKeys.add(item.key);
      }
    });
  }

  const currentSelfSufficiency = input.selfSufficiencyPct;
  const baseSelfSufficiency = baselineSnapshot?.selfSufficiencyPct ?? null;

  let dependencyStatus = "Flat";
  let dependencySummary = "";
  let dependencyDetail = "";

  if (!hasSufficientHistory) {
    dependencyStatus = "Baseline established";
    dependencySummary = currentSelfSufficiency !== null
      ? `${currentSelfSufficiency}% of active work is non-founder owned.`
      : "Current founder dependency baseline established.";
    dependencyDetail = "At least 2 daily posture snapshots are required to establish a historical 7-day trend.";
  } else if (currentSelfSufficiency !== null && baseSelfSufficiency !== null) {
    const diff = currentSelfSufficiency - baseSelfSufficiency;
    if (diff > 2) {
      dependencyStatus = "Improving";
      dependencySummary = `Ownership outside the primary Founder increased by +${diff}% (from ${baseSelfSufficiency}% to ${currentSelfSufficiency}%).`;
    } else if (diff < -2) {
      dependencyStatus = "Worsening";
      dependencySummary = `Founder dependency increased; non-founder share fell by ${Math.abs(diff)}% (from ${baseSelfSufficiency}% to ${currentSelfSufficiency}%).`;
    } else {
      dependencyStatus = "Flat";
      dependencySummary = `Ownership outside the primary Founder remains stable at ${currentSelfSufficiency}% (baseline: ${baseSelfSufficiency}%).`;
    }
    dependencyDetail = `Top owner carries ${input.topOwnerShare ?? 0}% of active work. ${input.delegateItemCount > 0 ? `${input.delegateItemCount} founder-owned item${input.delegateItemCount === 1 ? " is" : "s are"} ready for delegation.` : "No routine founder-owned items currently flagged for delegation."}`;
  } else {
    dependencyStatus = "Stable";
    dependencySummary = "Current non-founder ownership baseline tracked.";
    dependencyDetail = "Ownership metrics are derived from active Actions, Projects, Leads and Problems.";
  }

  const next7Days: FounderOperatingReviewItem[] = [];
  const usedNext7Keys = new Set<string>();

  if (input.focusCandidates.length > 0) {
    const topFocus = input.focusCandidates[0];
    const key = `${topFocus.objectType}:${topFocus.id}`;
    next7Days.push({
      id: topFocus.id,
      objectType: topFocus.objectType,
      title: topFocus.title,
      area: topFocus.area,
      why: `Top immediate execution priority: ${topFocus.reason}`,
      navigation: { type: "record", objectType: topFocus.objectType, id: topFocus.id },
    });
    usedNext7Keys.add(key);
    usedNext7Keys.add(topFocus.key);
  }

  if (input.unassignedCarriedCount > 0 && !usedNext7Keys.has("People:unassigned")) {
    next7Days.push({
      id: "unassigned",
      objectType: "People",
      title: `${input.unassignedCarriedCount} unassigned active item${input.unassignedCarriedCount === 1 ? "" : "s"} requiring owner triage`,
      area: "People",
      why: "Assigning clear active owners prevents dropped execution and founder bottlenecking.",
      navigation: { type: "unassigned" },
    });
    usedNext7Keys.add("People:unassigned");
  } else {
    for (const reviewItem of input.founderReviewQueue) {
      const key = `${reviewItem.kind}:${reviewItem.id}`;
      if (!usedNext7Keys.has(key)) {
        next7Days.push({
          id: reviewItem.id,
          objectType: reviewItem.kind,
          title: reviewItem.title,
          area: reviewItem.pillar,
          why: `${reviewItem.reasonCategory}: ${reviewItem.whyItMatters}`,
          navigation: { type: "record", objectType: reviewItem.kind, id: reviewItem.id },
        });
        usedNext7Keys.add(key);
        break;
      }
    }
  }

  for (const watchItem of input.watch) {
    const key = `${watchItem.objectType}:${watchItem.id}`;
    if (!usedNext7Keys.has(key)) {
      next7Days.push({
        id: watchItem.id,
        objectType: watchItem.objectType,
        title: watchItem.title,
        area: watchItem.area,
        why: `Near-term focus: ${watchItem.why}`,
        navigation: { type: "watch", index: watchItem.sourceIndex },
      });
      usedNext7Keys.add(key);
      break;
    }
  }

  if (next7Days.length < 3) {
    for (const candidate of input.focusCandidates) {
      if (next7Days.length >= 3) break;
      const key = `${candidate.objectType}:${candidate.id}`;
      if (!usedNext7Keys.has(key)) {
        next7Days.push({
          id: candidate.id,
          objectType: candidate.objectType,
          title: candidate.title,
          area: candidate.area,
          why: candidate.reason,
          navigation: { type: "record", objectType: candidate.objectType, id: candidate.id },
        });
        usedNext7Keys.add(key);
      }
    }
  }

  let headline = "";
  if (!hasSufficientHistory) {
    headline = "7-Day Operating Trajectory: Baseline established for today — gathering 7-day posture history";
  } else if (improved.length > 0 && deteriorated.length === 0) {
    headline = `7-Day Operating Trajectory: Positive momentum — ${improved.length} area${improved.length === 1 ? "" : "s"} improved`;
  } else if (deteriorated.length > 0 && improved.length === 0) {
    headline = `7-Day Operating Trajectory: Operating load increased — ${deteriorated.length} area${deteriorated.length === 1 ? "" : "s"} deteriorated`;
  } else if (improved.length > 0 && deteriorated.length > 0) {
    headline = `7-Day Operating Trajectory: Mixed trajectory — ${improved.length} improved, ${deteriorated.length} deteriorated`;
  } else {
    headline = "7-Day Operating Trajectory: Stable posture across recent posture snapshots";
  }

  return {
    headline,
    hasSufficientHistory,
    snapshotCount: input.snapshots.length,
    baselineDateLabel,
    improved,
    deteriorated,
    recurring,
    founderDependency: {
      status: dependencyStatus,
      summary: dependencySummary,
      detail: dependencyDetail,
    },
    next7Days,
    strategicRiskTrajectory,
  };
}

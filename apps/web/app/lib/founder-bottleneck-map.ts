export type FounderBottleneckSeverity = "Critical" | "Material" | "Emerging";
export type FounderBottleneckCategory = "Authority" | "Execution" | "Ownership" | "Capability" | "Recurrence";

export type FounderBottleneckItem = {
  id: string;
  category: FounderBottleneckCategory;
  title: string;
  objectType: string;
  area?: string;
  owner?: string;
  severity: FounderBottleneckSeverity;
  why: string;
  releasePath: string;
  // Capability cards navigate to the People view, unlike record-backed People signals.
  openPeopleView?: true;
};

type RecordFact = { id: string; title: string; area?: string; owner?: string };
export type FounderBottleneckBlockedAction = RecordFact & {
  isBlocked: boolean;
  isFounderOwned: boolean;
  dependencyReason: string | null;
};
export type FounderBottleneckProject = RecordFact & {
  health: string;
  reviewDue: boolean;
  reviewFuture: boolean;
  reviewNote?: string;
  nextReviewDate?: string;
};
type ReadinessFact = { name: string; missingFields: readonly string[] };

export type FounderBottleneckMapInput = {
  reviewItems: readonly {
    id: string; kind: string; title: string; pillar: string; owner: string;
    reasonCategory: string; whyItMatters: string;
  }[];
  retainedProjects: readonly (RecordFact & { founderObjectiveTitle: string })[];
  opportunities: readonly (RecordFact & { status: string; strategicFit: string; hasSettledDecision: boolean })[];
  decisionsWithoutExecution: readonly RecordFact[];
  blockedActions: readonly FounderBottleneckBlockedAction[];
  overdueActions: readonly (RecordFact & { dueDate: string; isOverdue: boolean })[];
  executionProjects: readonly FounderBottleneckProject[];
  convergentRisks: readonly {
    clusterKey: string; title: string;
    root: { id: string; objectType: string; area: string };
    categoryCount: number; recordCount: number;
  }[];
  learningGaps: readonly (RecordFact & { severity: string; frequency: string })[];
  // Every routine item is retained here: capability counts precede record deduplication.
  routineDelegateItems: readonly {
    id: string; objectType: string; title: string; pillar: string; owner: string;
    capacityRankedNames: readonly string[];
  }[];
  activeOperationalPeopleCount: number;
  delegationReadyPeopleCount: number;
  teamReadinessGaps: readonly ReadinessFact[];
  cofounderReadinessGaps: readonly ReadinessFact[];
  delegationReadinessGaps: readonly ReadinessFact[];
};

export type FounderBottleneckMapResult = {
  summary: {
    headline: string;
    totalCount: number;
    criticalCount: number;
    materialCount: number;
    emergingCount: number;
    topCategoryText: string;
  };
  bottlenecks: FounderBottleneckItem[];
};

// Shared with the adapter so overdue clock samples exclude precisely the claimed blockers.
export function isFounderBottleneckBlockedAction(action: FounderBottleneckBlockedAction): boolean {
  return (action.isBlocked || action.dependencyReason !== null)
    && (action.isFounderOwned || (action.dependencyReason?.startsWith("WAITING ON DECISION:") ?? false));
}

export function isFounderBottleneckExecutionProject(project: FounderBottleneckProject): boolean {
  if (project.health === "Waiting" && project.reviewFuture) return false;
  return project.health === "Blocked" || project.reviewDue;
}

export function buildFounderBottleneckMap(input: FounderBottleneckMapInput): FounderBottleneckMapResult {
  const raw: FounderBottleneckItem[] = [];
  const usedKeys = new Set<string>();
  const add = (key: string, item: FounderBottleneckItem) => {
    raw.push(item);
    usedKeys.add(key);
  };

  for (const item of input.reviewItems) {
    const key = `${item.kind}:${item.id}`;
    if (usedKeys.has(key)) continue;
    add(key, {
      id: item.id, category: "Authority", title: item.title, objectType: item.kind,
      area: item.pillar, owner: item.owner,
      severity: ["Critical escalation", "Authority required", "Blocked project decision"].includes(item.reasonCategory) ? "Critical" : "Material",
      why: `${item.reasonCategory}: ${item.whyItMatters}`,
      releasePath: item.reasonCategory === "Blocked project decision"
        ? "Provide explicit founder decision or scope approval to unblock project delivery."
        : item.reasonCategory === "Review due"
          ? "Complete formal decision review, record actual outcome and rating."
          : "Issue formal founder decision or strategic approval to establish baseline.",
    });
  }

  for (const project of input.retainedProjects) {
    const key = `Project:${project.id}`;
    if (usedKeys.has(key)) continue;
    add(key, {
      id: project.id, category: "Authority", title: `Founder-retained project: ${project.title}`,
      objectType: "Project", area: project.area, owner: project.owner, severity: "Material",
      why: `Linked to active Strategic Objective '${project.founderObjectiveTitle}', explicitly allocated to founder attention.`,
      releasePath: "Retain under founder authority while this Strategic Objective requires founder attention.",
    });
  }

  for (const opportunity of input.opportunities) {
    if (opportunity.status !== "Evaluating" || !["High", "Exceptional"].includes(opportunity.strategicFit)) continue;
    const key = `Opportunity:${opportunity.id}`;
    if (usedKeys.has(key) || opportunity.hasSettledDecision) continue;
    add(key, {
      id: opportunity.id, category: "Authority", title: opportunity.title, objectType: "Opportunity",
      area: opportunity.area, owner: opportunity.owner || "Unassigned",
      severity: opportunity.strategicFit === "Exceptional" ? "Critical" : "Material",
      why: `High strategic-fit opportunity ('${opportunity.title}') remains ${opportunity.status.toLowerCase()} without a settled founder decision.`,
      releasePath: "Review strategic alignment and issue formal founder approval decision.",
    });
  }

  for (const decision of input.decisionsWithoutExecution) {
    const key = `Decision:${decision.id}`;
    if (usedKeys.has(key)) continue;
    add(key, {
      id: decision.id, category: "Execution", title: decision.title, objectType: "Decision",
      area: decision.area, owner: decision.owner, severity: "Material",
      why: `Active decision '${decision.title}' has no direct or project-mediated execution path, stalling implementation.`,
      releasePath: "Create or link an active Action or Project to establish an executable path.",
    });
  }

  for (const action of input.blockedActions) {
    const key = `Action:${action.id}`;
    if (usedKeys.has(key) || !isFounderBottleneckBlockedAction(action)) continue;
    add(key, {
      id: action.id, category: "Execution", title: action.title, objectType: "Action",
      area: action.area, owner: action.owner, severity: "Critical",
      why: action.dependencyReason !== null
        ? `Action '${action.title}' is blocked by an upstream dependency (${action.dependencyReason.replace("BLOCKED BY PROBLEM: ", "").replace("WAITING ON DECISION: ", "")}).`
        : `Action '${action.title}' is blocked, preventing downstream operational progress.`,
      releasePath: action.dependencyReason !== null
        ? "Resolve the upstream dependency to clear the execution blocker."
        : "Remove operational blocker or re-sequence work.",
    });
  }

  for (const action of input.overdueActions) {
    const key = `Action:${action.id}`;
    if (usedKeys.has(key) || !action.isOverdue) continue;
    add(key, {
      id: action.id, category: "Execution", title: action.title, objectType: "Action",
      area: action.area, owner: action.owner, severity: "Material",
      why: `Founder-owned action '${action.title}' is overdue (due ${action.dueDate.slice(0, 10)}), creating execution drag.`,
      releasePath: "Complete execution or reassign to an operational owner in People.",
    });
  }

  for (const project of input.executionProjects) {
    const key = `Project:${project.id}`;
    if (usedKeys.has(key) || !isFounderBottleneckExecutionProject(project)) continue;
    add(key, {
      id: project.id, category: "Execution", title: project.title, objectType: "Project",
      area: project.area, owner: project.owner || "Unassigned",
      severity: project.health === "Blocked" ? "Critical" : "Material",
      why: project.health === "Blocked"
        ? `Project '${project.title}' is blocked${project.reviewNote ? `: ${project.reviewNote}` : "."}`
        : `Project '${project.title}' has reached its review date (${project.nextReviewDate}) without resolution.`,
      releasePath: project.health === "Blocked"
        ? "Remove the blocker or correct the project course."
        : "Complete the project review and set the next intervention point.",
    });
  }

  for (const cluster of input.convergentRisks) {
    if (usedKeys.has(cluster.clusterKey)) continue;
    add(cluster.clusterKey, {
      id: cluster.root.id, category: "Recurrence", title: cluster.title,
      objectType: cluster.root.objectType, area: cluster.root.area, severity: "Critical",
      why: `Convergent risk — one situation generates ${cluster.categoryCount} signal categories across ${cluster.recordCount} linked records, requiring repeated founder intervention.`,
      releasePath: "Address root cause across linked records to resolve systemic recurrence.",
    });
  }

  for (const problem of input.learningGaps) {
    const key = `Problem:${problem.id}`;
    if (usedKeys.has(key)) continue;
    add(key, {
      id: problem.id, category: "Recurrence", title: problem.title, objectType: "Problem",
      area: problem.area, owner: problem.owner,
      severity: problem.severity === "Critical" ? "Critical" : "Material",
      why: `Unresolved recurring problem '${problem.title}' (${problem.frequency}) occurs repeatedly without an active SOP or system.`,
      releasePath: "Capture operational learning into a System or SOP to institutionalise prevention.",
    });
  }

  const routineCount = input.routineDelegateItems.length;
  if (routineCount > 0) {
    if (input.activeOperationalPeopleCount === 0) {
      const key = "People:no-nonfounder";
      if (!usedKeys.has(key)) add(key, {
        id: "unassigned", category: "Capability", title: "No active non-founder team members available",
        objectType: "People", area: "People", severity: "Critical",
        why: `${routineCount} routine founder-owned item(s) sit with the founder because no active non-founder team member exists.`,
        releasePath: "Onboard or activate team members in People to absorb operational load.",
        openPeopleView: true,
      });
    } else if (input.delegationReadyPeopleCount === 0 && input.teamReadinessGaps.length > 0) {
      const key = "People:readiness-gap";
      if (!usedKeys.has(key)) add(key, {
        id: "unassigned", category: "Capability", title: "Team delegation readiness gap",
        objectType: "People", area: "People", severity: "Material",
        why: `${routineCount} founder-owned routine item(s) are ready for delegation, but readiness gaps remain: ${input.teamReadinessGaps.map((person) => `${person.name} (${person.missingFields.join(", ")})`).join("; ")}.`,
        releasePath: `Complete delegation readiness in People: ${input.teamReadinessGaps.map((person) => `${person.name} — ${person.missingFields.join(", ")}`).join("; ")}.`,
        openPeopleView: true,
      });
    }
  }

  if (input.cofounderReadinessGaps.length > 0) {
    const key = "People:cofounder-readiness-gap";
    if (!usedKeys.has(key)) add(key, {
      id: "cofounder-readiness-gap", category: "Capability", title: "Co-founder delegation readiness gap",
      objectType: "People", area: "People", severity: "Emerging",
      why: `${input.cofounderReadinessGaps.map((person) => `${person.name} (${person.missingFields.join(", ")})`).join("; ")} ${input.cofounderReadinessGaps.length === 1 ? "has" : "have"} incomplete Co-founder delegation readiness in People.`,
      releasePath: `Complete Co-founder delegation readiness in People: ${input.cofounderReadinessGaps.map((person) => `${person.name} — ${person.missingFields.join(", ")}`).join("; ")}.`,
      openPeopleView: true,
    });
  }

  for (const item of input.routineDelegateItems) {
    const key = `${item.objectType}:${item.id}`;
    if (usedKeys.has(key)) continue;
    add(key, {
      id: item.id, category: "Ownership", title: `Routine founder-owned ${item.objectType.toLowerCase()}: ${item.title}`,
      objectType: item.objectType, area: item.pillar, owner: item.owner, severity: "Material",
      why: `Founder carries routine ${item.objectType.toLowerCase()} execution ('${item.title}') that is suitable for delegation.`,
      releasePath: item.capacityRankedNames.length > 0
        ? `Delegate ownership to an active team member for ${item.pillar} (${item.capacityRankedNames.join(", ")}).`
        : input.delegationReadyPeopleCount > 0
          ? `Assign a delegation-ready Person to ${item.pillar} before transferring ownership.`
          : `Complete delegation readiness in People: ${input.delegationReadinessGaps.map((person) => `${person.name} — ${person.missingFields.join(", ")}`).join("; ")}, then transfer ownership.`,
    });
  }

  const severityRank: Record<FounderBottleneckSeverity, number> = { Critical: 3, Material: 2, Emerging: 1 };
  const categoryRank: Record<FounderBottleneckCategory, number> = { Authority: 5, Execution: 4, Recurrence: 3, Capability: 2, Ownership: 1 };
  const bottlenecks = [...raw].sort((left, right) =>
    severityRank[right.severity] - severityRank[left.severity]
    || categoryRank[right.category] - categoryRank[left.category]
    || left.title.localeCompare(right.title));
  const categoryCounts: Record<FounderBottleneckCategory, number> = { Authority: 0, Execution: 0, Recurrence: 0, Capability: 0, Ownership: 0 };
  for (const item of bottlenecks) categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1;
  const names: Record<FounderBottleneckCategory, string> = {
    Authority: "Authority decisions", Execution: "Execution blockers", Recurrence: "Systemic recurrence",
    Capability: "Delegation capacity", Ownership: "Ownership load",
  };
  const counts = (Object.entries(categoryCounts) as [FounderBottleneckCategory, number][])
    .filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1]);
  let headline = "No structural founder bottlenecks are currently detected.";
  let topCategoryText = "None";
  if (counts.length > 0) {
    const first = counts[0];
    const second = counts[1];
    if (second && second[1] >= Math.max(1, first[1] - 1)) {
      topCategoryText = `${names[first[0]]} & ${names[second[0]]}`;
      headline = `Founder dependency is currently concentrated in ${names[first[0]].toLowerCase()} and ${names[second[0]].toLowerCase()}.`;
    } else {
      topCategoryText = names[first[0]];
      headline = `Founder dependency is currently concentrated in ${names[first[0]].toLowerCase()}.`;
    }
  }
  return {
    summary: {
      headline, totalCount: bottlenecks.length,
      criticalCount: bottlenecks.filter((item) => item.severity === "Critical").length,
      materialCount: bottlenecks.filter((item) => item.severity === "Material").length,
      emergingCount: bottlenecks.filter((item) => item.severity === "Emerging").length,
      topCategoryText,
    },
    bottlenecks,
  };
}

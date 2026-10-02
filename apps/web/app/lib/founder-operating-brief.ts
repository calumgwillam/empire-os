export type OperatingBriefRecordInput = {
  id: string;
  title: string;
  area: string;
  owner: string;
};

export type OperatingBriefDomainItem = {
  id: string;
  objectType: string;
  title: string;
  area: string;
  owner?: string;
  why: string;
};

export type OperatingBriefDelegateInput = {
  id: string;
  objectType: "Action" | "Project" | "Lead" | "Problem";
  title: string;
  pillar: string;
  owner: string;
  whatIsChanging: string;
  whyItMatters: string;
};

export type OperatingBriefDelegateItem = OperatingBriefDomainItem & {
  objectType: OperatingBriefDelegateInput["objectType"];
};

export type FounderOperatingBriefInput = {
  focusCandidates: readonly {
    key: string;
    objectType: string;
    id: string;
    title: string;
    area: string;
    reason: string;
  }[];
  delegateItems: readonly OperatingBriefDelegateInput[];
  reviewItems: readonly {
    kind: string;
    id: string;
    title: string;
    pillar: string;
    owner: string;
    reasonCategory: string;
    whyItMatters: string;
  }[];
  actions: readonly (OperatingBriefRecordInput & {
    isActive: boolean;
    isWaiting: boolean;
    dueDate: string;
  })[];
  projects: readonly (OperatingBriefRecordInput & {
    isActive: boolean;
    status: string;
    targetCompletionDate: string;
  })[];
  activeLeads: readonly (OperatingBriefRecordInput & {
    status: string;
    followUpDate: string;
  })[];
  decisions: readonly (OperatingBriefRecordInput & {
    isActive: boolean;
    reviewDate: string;
  })[];
  opportunities: readonly (OperatingBriefRecordInput & {
    status: string;
    strategicFit: string;
  })[];
  nowMs: number;
  startOfTodayMs: number;
};

export type FounderOperatingBriefResult = {
  doNow: OperatingBriefDomainItem[];
  delegate: OperatingBriefDelegateItem[];
  decide: OperatingBriefDomainItem[];
  watch: OperatingBriefDomainItem[];
};

export function buildFounderOperatingBrief(input: FounderOperatingBriefInput): FounderOperatingBriefResult {
  const usedRecordKeys = new Set<string>();
  const doNow: OperatingBriefDomainItem[] = [];
  for (const candidate of input.focusCandidates) {
    if (doNow.length >= 3) break;
    const recordKey = `${candidate.objectType}:${candidate.id}`;
    if (usedRecordKeys.has(candidate.key) || usedRecordKeys.has(recordKey)) continue;
    doNow.push({
      id: candidate.id,
      objectType: candidate.objectType,
      title: candidate.title,
      area: candidate.area,
      why: candidate.reason,
    });
    usedRecordKeys.add(candidate.key);
    usedRecordKeys.add(recordKey);
  }

  const delegate: OperatingBriefDelegateItem[] = [];
  for (const item of input.delegateItems) {
    if (delegate.length >= 3) break;
    const key = `${item.objectType}:${item.id}`;
    if (usedRecordKeys.has(key)) continue;
    delegate.push({
      id: item.id,
      objectType: item.objectType,
      title: item.title,
      area: item.pillar,
      owner: item.owner,
      why: item.whatIsChanging || item.whyItMatters,
    });
    usedRecordKeys.add(key);
  }

  const decide: OperatingBriefDomainItem[] = [];
  for (const item of input.reviewItems) {
    if (decide.length >= 3) break;
    const key = `${item.kind}:${item.id}`;
    if (usedRecordKeys.has(key)) continue;
    decide.push({
      id: item.id,
      objectType: item.kind,
      title: item.title,
      area: item.pillar,
      owner: item.owner,
      why: `${item.reasonCategory}: ${item.whyItMatters}`,
    });
    usedRecordKeys.add(key);
  }

  const watchCandidates: { item: OperatingBriefDomainItem; urgencyDays: number }[] = [];
  const dayMs = 1000 * 60 * 60 * 24;

  // Due-soon Actions intentionally remain visible even when claimed by an earlier section.
  input.actions.filter((action) => action.isActive && !action.isWaiting).forEach((action) => {
    if (!action.dueDate) return;
    const dueMs = new Date(`${action.dueDate.slice(0, 10)}T00:00:00`).getTime();
    if (Number.isNaN(dueMs)) return;
    const days = Math.round((dueMs - input.startOfTodayMs) / dayMs);
    if (days >= 0 && days <= 14) {
      watchCandidates.push({
        item: {
          id: action.id,
          objectType: "Action",
          title: action.title,
          area: action.area,
          owner: action.owner,
          why: days === 0 ? "Due today — review execution momentum" : `Due in ${days} day${days === 1 ? "" : "s"} (${action.dueDate.slice(0, 10)})`,
        },
        urgencyDays: days,
      });
    }
  });

  input.projects.filter((project) => project.isActive).forEach((project) => {
    if (usedRecordKeys.has(`Project:${project.id}`)) return;
    if (!project.targetCompletionDate || project.status.trim().toLowerCase() === "blocked") return;
    const targetMs = new Date(`${project.targetCompletionDate}T00:00:00`).getTime();
    if (Number.isNaN(targetMs)) return;
    const days = Math.round((targetMs - input.nowMs) / dayMs);
    if (days >= 0 && days <= 21) {
      watchCandidates.push({
        item: {
          id: project.id,
          objectType: "Project",
          title: project.title,
          area: project.area,
          owner: project.owner || "Unassigned",
          why: days === 0 ? "Target completion date is today" : `Target completion in ${days} day${days === 1 ? "" : "s"} (${project.targetCompletionDate})`,
        },
        urgencyDays: days,
      });
    }
  });

  input.activeLeads.filter((lead) => !["Won", "Lost"].includes(lead.status)).forEach((lead) => {
    if (usedRecordKeys.has(`Lead:${lead.id}`) || !lead.followUpDate) return;
    const followMs = new Date(lead.followUpDate).getTime();
    if (Number.isNaN(followMs)) return;
    const days = Math.round((followMs - input.nowMs) / dayMs);
    if (days >= 0 && days <= 14) {
      watchCandidates.push({
        item: {
          id: lead.id,
          objectType: "Lead",
          title: lead.title,
          area: lead.area,
          owner: lead.owner || "Unassigned",
          why: days === 0 ? "Commercial follow-up date is today" : `Commercial follow-up in ${days} day${days === 1 ? "" : "s"} (${lead.followUpDate})`,
        },
        urgencyDays: days,
      });
    }
  });

  input.decisions.filter((decision) => decision.isActive).forEach((decision) => {
    if (usedRecordKeys.has(`Decision:${decision.id}`) || !decision.reviewDate) return;
    const reviewMs = new Date(decision.reviewDate).getTime();
    if (Number.isNaN(reviewMs)) return;
    const days = Math.round((reviewMs - input.nowMs) / dayMs);
    if (days > 0 && days <= 21) {
      watchCandidates.push({
        item: {
          id: decision.id,
          objectType: "Decision",
          title: decision.title,
          area: decision.area,
          owner: decision.owner || "Unassigned",
          why: `Review date approaching in ${days} day${days === 1 ? "" : "s"} (${decision.reviewDate.slice(0, 10)})`,
        },
        urgencyDays: days,
      });
    }
  });

  input.opportunities
    .filter((opportunity) => ["Evaluating", "On Hold"].includes(opportunity.status) && ["High", "Exceptional"].includes(opportunity.strategicFit))
    .forEach((opportunity) => {
      if (usedRecordKeys.has(`Opportunity:${opportunity.id}`)) return;
      watchCandidates.push({
        item: {
          id: opportunity.id,
          objectType: "Opportunity",
          title: opportunity.title,
          area: opportunity.area,
          owner: opportunity.owner || "Unassigned",
          why: `${opportunity.strategicFit} strategic-fit opportunity currently ${opportunity.status.toLowerCase()} — watch for timing trigger`,
        },
        urgencyDays: opportunity.strategicFit === "Exceptional" ? 5 : 10,
      });
    });

  watchCandidates.sort((first, second) =>
    first.urgencyDays - second.urgencyDays || first.item.title.localeCompare(second.item.title));
  return {
    doNow,
    delegate,
    decide,
    watch: watchCandidates.slice(0, 3).map((candidate) => candidate.item),
  };
}

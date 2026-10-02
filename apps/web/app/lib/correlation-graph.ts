export type CorrelationSignalledRecord = {
  recordKey: string;
  objectType: string;
  id: string;
  title: string;
  area: string;
  signals: Set<string>;
  baseScore: number;
};

export type CorrelationCluster = {
  clusterKey: string;
  title: string;
  records: CorrelationSignalledRecord[];
  categories: Set<string>;
  recordCount: number;
  contributingRecordCount: number;
  topScore: number;
};

type CaptureRelationshipInput = {
  id: string;
  sourceCaptureId?: string;
  relatedCapture?: string;
};

export type CorrelationGraphInput = {
  founderAuthorityItems: readonly { objectType: string; id: string; title: string; pillar: string }[];
  commandAttentionItems: readonly {
    objectType: string;
    id: string;
    title: string;
    area: string;
    reasons: readonly string[];
    priorityScore: number;
  }[];
  decisionReviewsDue: readonly {
    id: string;
    decisionTitle?: string;
    title: string;
    relatedArea?: string;
    relatedPillar?: string;
    area?: string;
  }[];
  decisionsWithoutExecution: readonly { id: string; title: string; area: string }[];
  learningGaps: readonly { id: string; title: string; area: string }[];
  staleUnownedWork: readonly {
    key: string;
    objectType: string;
    id: string;
    title: string;
    area: string;
    score: number;
  }[];
  staleRecords: readonly {
    objectType: string;
    id: string;
    title: string;
    area: string;
  }[];
  stalledOpportunities: readonly {
    id: string;
    title: string;
    area: string;
    strategicFit: string;
  }[];
  stalledLeads: readonly { id: string; title: string; area: string; quoteValue: number }[];
  cashBuffer: { title: string; severity: string } | null;
  fundingGap: { title: string } | null;
  overdueCommitments: readonly { id: string; title: string }[];
  overdueExpectedIncome: readonly { id: string; title: string }[];
  captures: readonly { id: string }[];
  problems: readonly CaptureRelationshipInput[];
  actions: readonly (CaptureRelationshipInput & {
    relatedProblem?: string;
    relatedDecision?: string;
    relatedOpportunity?: string;
  })[];
  decisions: readonly (CaptureRelationshipInput & { relatedOpportunity?: string })[];
  opportunities: readonly CaptureRelationshipInput[];
  lessons: readonly (CaptureRelationshipInput & {
    relatedProblem?: string;
    relatedDecision?: string;
    relatedProject?: string;
    relatedSystem?: string;
  })[];
  systems: readonly (CaptureRelationshipInput & { relatedLesson?: string })[];
  sops: readonly (CaptureRelationshipInput & { relatedSystem?: string; relatedLesson?: string })[];
  projects: readonly (CaptureRelationshipInput & {
    relatedActionIds?: readonly string[];
    relatedDecisionIds?: readonly string[];
    relatedSystemIds?: readonly string[];
    relatedSopIds?: readonly string[];
  })[];
  leads: readonly { id: string }[];
};

export type CorrelationGraphResult = {
  signalled: Map<string, CorrelationSignalledRecord>;
  clusters: CorrelationCluster[];
  convergentRisks: CorrelationCluster[];
  clusterByRecordKey: Map<string, CorrelationCluster>;
};

function getAreaText(record: { relatedArea?: string; relatedPillar?: string; area?: string }): string {
  return record.relatedPillar || record.relatedArea || record.area || "";
}

export function buildCorrelationGraph(input: CorrelationGraphInput): CorrelationGraphResult {
  const signalled = new Map<string, CorrelationSignalledRecord>();
  const addSignal = (recordKey: string, objectType: string, id: string, title: string, area: string, signal: string, baseScore: number) => {
    const existing = signalled.get(recordKey);
    if (existing) {
      existing.signals.add(signal);
      existing.baseScore = Math.max(existing.baseScore, baseScore);
    } else {
      signalled.set(recordKey, { recordKey, objectType, id, title, area, signals: new Set([signal]), baseScore });
    }
  };

  input.founderAuthorityItems.forEach((item) =>
    addSignal(`${item.objectType}:${item.id}`, item.objectType, item.id, item.title, item.pillar, "founder authority", 400));

  input.commandAttentionItems
    .filter((item) => item.reasons.some((reason) => reason === "BLOCKED PROJECT" || reason === "BLOCKED" || reason.startsWith("BLOCKED BY PROBLEM:")))
    .forEach((item) => addSignal(`${item.objectType}:${item.id}`, item.objectType, item.id, item.title, item.area, "blocked", 360 + item.priorityScore));

  input.commandAttentionItems
    .filter((item) => item.reasons.some((reason) => reason.startsWith("OVERDUE")))
    .forEach((item) => addSignal(`${item.objectType}:${item.id}`, item.objectType, item.id, item.title, item.area, "overdue", 200 + item.priorityScore));

  input.decisionReviewsDue.forEach((decision) =>
    addSignal(`Decision:${decision.id}`, "Decision", decision.id, decision.decisionTitle || decision.title, getAreaText(decision) || "Unassigned", "review due", 300));

  input.decisionsWithoutExecution.forEach((decision) =>
    addSignal(`Decision:${decision.id}`, "Decision", decision.id, decision.title, decision.area, "no execution path", 280));

  input.learningGaps.forEach((problem) =>
    addSignal(`Problem:${problem.id}`, "Problem", problem.id, problem.title, problem.area, "learning not captured", 240));

  input.staleUnownedWork.forEach((item) =>
    addSignal(item.key, item.objectType, item.id, item.title, item.area, "no valid owner", item.score));

  input.staleRecords.forEach((item) =>
    addSignal(`${item.objectType}:${item.id}`, item.objectType, item.id, item.title, item.area, "stale record", 230));

  input.stalledOpportunities.forEach((item) =>
    addSignal(`Opportunity:${item.id}`, "Opportunity", item.id, item.title, item.area, "opportunity stalled", item.strategicFit === "Exceptional" ? 290 : 250));

  input.stalledLeads.forEach((item) =>
    addSignal(`Lead:${item.id}`, "Lead", item.id, item.title, item.area, "lead stalled", item.quoteValue >= 1000 ? 240 : 180));

  if (input.cashBuffer) {
    addSignal("Finance:cash-buffer", "Finance", "cash-buffer", input.cashBuffer.title, "Finance", "cash buffer pressure", input.cashBuffer.severity === "critical" ? 380 : 300);
  }
  if (input.fundingGap) {
    addSignal("Finance:funding-gap", "Finance", "funding-gap", input.fundingGap.title, "Finance", "committed obligations exceed available cash", 360);
  }
  input.overdueCommitments.forEach((item) =>
    addSignal(`Finance:commitment:${item.id}`, "Finance", `commitment:${item.id}`, item.title, "Finance", "overdue commitment", 310));
  input.overdueExpectedIncome.forEach((item) =>
    addSignal(`Finance:income:${item.id}`, "Finance", `income:${item.id}`, item.title, "Finance", "expected income overdue", 260));

  const adjacency = new Map<string, Set<string>>();
  const recordKeys = new Set<string>([
    ...input.captures.map((capture) => `Capture:${capture.id}`),
    ...input.problems.map((problem) => `Problem:${problem.id}`),
    ...input.actions.map((action) => `Action:${action.id}`),
    ...input.decisions.map((decision) => `Decision:${decision.id}`),
    ...input.opportunities.map((opportunity) => `Opportunity:${opportunity.id}`),
    ...input.lessons.map((lesson) => `Lesson:${lesson.id}`),
    ...input.systems.map((system) => `System:${system.id}`),
    ...input.sops.map((sop) => `SOP:${sop.id}`),
    ...input.projects.map((project) => `Project:${project.id}`),
    ...input.leads.map((lead) => `Lead:${lead.id}`),
  ]);
  const link = (a: string, b: string) => {
    if (a === b) return;
    if (!recordKeys.has(a) || !recordKeys.has(b)) return;
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
  };

  const linkCapture = (recordKey: string, sourceCaptureId?: string, relatedCaptureId?: string) => {
    const captureId = relatedCaptureId || sourceCaptureId;
    if (captureId) link(recordKey, `Capture:${captureId}`);
  };

  input.actions.forEach((action) => {
    const actionKey = `Action:${action.id}`;
    if (action.relatedProblem) link(`Action:${action.id}`, `Problem:${action.relatedProblem}`);
    if (action.relatedDecision) link(`Action:${action.id}`, `Decision:${action.relatedDecision}`);
    if (action.relatedOpportunity) link(`Action:${action.id}`, `Opportunity:${action.relatedOpportunity}`);
    linkCapture(actionKey, action.sourceCaptureId, action.relatedCapture);
  });
  input.decisions.forEach((decision) => {
    if (decision.relatedOpportunity) link(`Decision:${decision.id}`, `Opportunity:${decision.relatedOpportunity}`);
    linkCapture(`Decision:${decision.id}`, decision.sourceCaptureId, decision.relatedCapture);
  });
  input.problems.forEach((problem) => {
    linkCapture(`Problem:${problem.id}`, problem.sourceCaptureId, problem.relatedCapture);
  });
  input.opportunities.forEach((opportunity) => {
    linkCapture(`Opportunity:${opportunity.id}`, opportunity.sourceCaptureId, opportunity.relatedCapture);
  });
  input.lessons.forEach((lesson) => {
    if (lesson.relatedProblem) link(`Lesson:${lesson.id}`, `Problem:${lesson.relatedProblem}`);
    if (lesson.relatedDecision) link(`Lesson:${lesson.id}`, `Decision:${lesson.relatedDecision}`);
    if (lesson.relatedProject) link(`Lesson:${lesson.id}`, `Project:${lesson.relatedProject}`);
    if (lesson.relatedSystem) link(`Lesson:${lesson.id}`, `System:${lesson.relatedSystem}`);
    linkCapture(`Lesson:${lesson.id}`, lesson.sourceCaptureId, lesson.relatedCapture);
  });
  input.systems.forEach((system) => {
    if (system.relatedLesson) link(`System:${system.id}`, `Lesson:${system.relatedLesson}`);
    linkCapture(`System:${system.id}`, system.sourceCaptureId, system.relatedCapture);
  });
  input.sops.forEach((sop) => {
    if (sop.relatedSystem) link(`SOP:${sop.id}`, `System:${sop.relatedSystem}`);
    if (sop.relatedLesson) link(`SOP:${sop.id}`, `Lesson:${sop.relatedLesson}`);
    linkCapture(`SOP:${sop.id}`, sop.sourceCaptureId, sop.relatedCapture);
  });
  input.projects.forEach((project) => {
    linkCapture(`Project:${project.id}`, project.sourceCaptureId);
    (project.relatedActionIds || []).forEach((actionId) => link(`Project:${project.id}`, `Action:${actionId}`));
    (project.relatedDecisionIds || []).forEach((decisionId) => link(`Project:${project.id}`, `Decision:${decisionId}`));
    (project.relatedSystemIds || []).forEach((systemId) => link(`Project:${project.id}`, `System:${systemId}`));
    (project.relatedSopIds || []).forEach((sopId) => link(`Project:${project.id}`, `SOP:${sopId}`));
  });

  const assignedSignalledRecords = new Set<string>();
  const clusters: CorrelationCluster[] = [];

  signalled.forEach((record, recordKey) => {
    if (assignedSignalledRecords.has(recordKey)) return;

    const component: CorrelationSignalledRecord[] = [];
    const visitedGraphNodes = new Set<string>([recordKey]);
    const queue = [recordKey];

    while (queue.length > 0) {
      const current = queue.pop()!;
      const currentRecord = signalled.get(current);
      if (currentRecord) {
        component.push(currentRecord);
        assignedSignalledRecords.add(current);
      }
      const neighbours = adjacency.get(current);
      if (neighbours) {
        neighbours.forEach((neighbour) => {
          if (!visitedGraphNodes.has(neighbour)) {
            visitedGraphNodes.add(neighbour);
            queue.push(neighbour);
          }
        });
      }
    }

    const categories = new Set<string>();
    component.forEach((item) => item.signals.forEach((signal) => categories.add(signal)));

    const root = component.reduce((best, item) => (item.baseScore > best.baseScore ? item : best), component[0]);

    clusters.push({
      clusterKey: `cluster:${root.recordKey}`,
      title: root.title,
      records: component,
      categories,
      recordCount: component.length,
      contributingRecordCount: component.filter((item) => item.signals.size > 0).length,
      topScore: root.baseScore,
    });
  });

  const convergentRisks = clusters
    .filter((cluster) => cluster.categories.size >= 3 && cluster.recordCount >= 2 && cluster.contributingRecordCount >= 2)
    .sort((a, b) => b.categories.size - a.categories.size || b.recordCount - a.recordCount || b.topScore - a.topScore);

  const clusterByRecordKey = new Map<string, CorrelationCluster>();
  clusters.forEach((cluster) => {
    cluster.records.forEach((record) => clusterByRecordKey.set(record.recordKey, cluster));
  });

  return { signalled, clusters, convergentRisks, clusterByRecordKey };
}
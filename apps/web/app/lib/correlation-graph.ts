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
  rootRecordKey: string;
  title: string;
  records: CorrelationSignalledRecord[];
  categories: Set<string>;
  recordCount: number;
  contributingRecordCount: number;
  topScore: number;
  // Resolved identity links that connected a strategic-risk signal into this situation.
  strategicRiskLinks: CorrelationStrategicRiskClusterLink[];
  // Non-transitive context records (e.g. a Person) attached through explicit strategic-risk links.
  contextRecords: CorrelationContextClusterRecord[];
};

export const CORRELATION_CONVERGENCE_MIN_CATEGORIES = 3;
export const CORRELATION_CONVERGENCE_MIN_RECORDS = 2;

// "material" signals count toward convergence; "corroborating" signals join and strengthen a
// situation but can never create convergence on their own.
export type CorrelationStrategicRiskWeight = "material" | "corroborating";

export type CorrelationStrategicRiskLink = {
  recordKey: string;
  via: string;
};

export type CorrelationStrategicRiskInput = {
  recordKey: string;
  objectType: string;
  id: string;
  title: string;
  area: string;
  signal: string;
  baseScore: number;
  weight: CorrelationStrategicRiskWeight;
  links: readonly CorrelationStrategicRiskLink[];
};

export type CorrelationStrategicRiskClusterLink = {
  riskRecordKey: string;
  sharedRecordKey: string;
};

// A context record carries signals about a stable identity that is not part of the record graph
// (e.g. a Person's founder dependency or capability gap). It is deliberately non-transitive: it never
// joins two situations together, it only attaches to a situation whose strategic-risk signal explicitly
// links to it. Its categories strengthen that situation but it never counts as a contributing record,
// and its categories only count toward convergence when a material strategic risk links to it.
export type CorrelationContextRecordInput = {
  recordKey: string;
  objectType: string;
  id: string;
  title: string;
  area: string;
  signals: readonly string[];
  // Records whose state produced a signal. When every one of them is already in the situation, the signal is a
  // second representation of evidence already counted and adds no category.
  evidenceRecordKeysBySignal?: Readonly<Record<string, readonly string[]>>;
};

export type CorrelationContextClusterRecord = {
  recordKey: string;
  objectType: string;
  id: string;
  title: string;
  area: string;
  signals: string[];
  // Signals backed by evidence not already represented in the situation; only these add categories.
  independentSignals: string[];
  // Strategic-risk records in this situation that explicitly reference the context record.
  linkedByRiskRecordKeys: string[];
  // True when at least one linking strategic risk is material, so the context counts toward convergence.
  material: boolean;
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
  // Derived strategic-risk signals (e.g. Icarus) that correlate only through stable record identities.
  strategicRisks?: readonly CorrelationStrategicRiskInput[];
  // Context identities that strategic risks may reference; see CorrelationContextRecordInput.
  contextRecords?: readonly CorrelationContextRecordInput[];
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
  const materialSignals = new Map<string, Set<string>>();
  const addSignal = (recordKey: string, objectType: string, id: string, title: string, area: string, signal: string, baseScore: number, material = true) => {
    const existing = signalled.get(recordKey);
    if (existing) {
      existing.signals.add(signal);
      existing.baseScore = Math.max(existing.baseScore, baseScore);
    } else {
      signalled.set(recordKey, { recordKey, objectType, id, title, area, signals: new Set([signal]), baseScore });
    }
    if (material) {
      if (!materialSignals.has(recordKey)) materialSignals.set(recordKey, new Set());
      materialSignals.get(recordKey)!.add(signal);
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

  // Added last so existing records always start (and root) their own situations.
  const strategicRiskKeys = new Set<string>();
  const materialStrategicRiskKeys = new Set<string>();
  (input.strategicRisks ?? []).forEach((risk) => {
    strategicRiskKeys.add(risk.recordKey);
    if (risk.weight === "material") materialStrategicRiskKeys.add(risk.recordKey);
    addSignal(risk.recordKey, risk.objectType, risk.id, risk.title, risk.area, risk.signal, risk.baseScore, risk.weight === "material");
  });

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

  // Context records already present as signalled graph records participate natively instead (no double count).
  const contextByKey = new Map<string, CorrelationContextRecordInput>();
  (input.contextRecords ?? []).forEach((context) => {
    if (signalled.has(context.recordKey) || recordKeys.has(context.recordKey) || context.signals.length === 0) return;
    const existing = contextByKey.get(context.recordKey);
    if (!existing) {
      contextByKey.set(context.recordKey, { ...context, signals: [...new Set(context.signals)] });
      return;
    }
    const evidence: Record<string, readonly string[]> = { ...existing.evidenceRecordKeysBySignal };
    Object.entries(context.evidenceRecordKeysBySignal ?? {}).forEach(([signal, keys]) => {
      evidence[signal] = [...new Set([...(evidence[signal] ?? []), ...keys])];
    });
    contextByKey.set(context.recordKey, {
      ...existing,
      signals: [...new Set([...existing.signals, ...context.signals])],
      evidenceRecordKeysBySignal: evidence,
    });
  });
  const contextLinksByRisk = new Map<string, Set<string>>();

  // Strategic risks may link to any graph record, or to a signalled record outside the record graph (e.g. Finance).
  const resolvedRiskLinks = new Map<string, Set<string>>();
  (input.strategicRisks ?? []).forEach((risk) => {
    recordKeys.add(risk.recordKey);
    risk.links.forEach(({ recordKey }) => {
      if (recordKey === risk.recordKey) return;
      if (contextByKey.has(recordKey)) {
        if (!contextLinksByRisk.has(risk.recordKey)) contextLinksByRisk.set(risk.recordKey, new Set());
        contextLinksByRisk.get(risk.recordKey)!.add(recordKey);
        return;
      }
      if (!recordKeys.has(recordKey) && !signalled.has(recordKey)) return;
      recordKeys.add(recordKey);
      link(risk.recordKey, recordKey);
      if (!resolvedRiskLinks.has(risk.recordKey)) resolvedRiskLinks.set(risk.recordKey, new Set());
      resolvedRiskLinks.get(risk.recordKey)!.add(recordKey);
    });
  });

  const assignedSignalledRecords = new Set<string>();
  const clusters: CorrelationCluster[] = [];
  const convergenceByCluster = new Map<CorrelationCluster, number>();

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
    const materialCategories = new Set<string>();
    component.forEach((item) => materialSignals.get(item.recordKey)?.forEach((signal) => materialCategories.add(signal)));
    const materialRecordCount = component.filter((item) => (materialSignals.get(item.recordKey)?.size ?? 0) > 0).length;

    const contextLinks = new Map<string, Set<string>>();
    component
      .filter((item) => strategicRiskKeys.has(item.recordKey))
      .forEach((item) => contextLinksByRisk.get(item.recordKey)?.forEach((contextKey) => {
        if (!contextLinks.has(contextKey)) contextLinks.set(contextKey, new Set());
        contextLinks.get(contextKey)!.add(item.recordKey);
      }));
    const contextRecords: CorrelationContextClusterRecord[] = [...contextLinks.entries()]
      .map(([contextKey, riskKeys]) => {
        const context = contextByKey.get(contextKey)!;
        const linkedByRiskRecordKeys = [...riskKeys].sort();
        const signals = [...context.signals].sort();
        const independentSignals = signals.filter((signal) => {
          const evidence = context.evidenceRecordKeysBySignal?.[signal];
          return !evidence || evidence.length === 0 || evidence.some((recordKey) => !visitedGraphNodes.has(recordKey));
        });
        return {
          recordKey: context.recordKey,
          objectType: context.objectType,
          id: context.id,
          title: context.title,
          area: context.area,
          signals,
          independentSignals,
          linkedByRiskRecordKeys,
          material: linkedByRiskRecordKeys.some((riskKey) => materialStrategicRiskKeys.has(riskKey)),
        };
      })
      .sort((left, right) => left.recordKey.localeCompare(right.recordKey));
    contextRecords.forEach((context) => context.independentSignals.forEach((signal) => {
      categories.add(signal);
      if (context.material) materialCategories.add(signal);
    }));

    // Strategic-risk signals strengthen a situation but never rename it while an operational record is present.
    const operationalRecords = component.filter((item) => !strategicRiskKeys.has(item.recordKey));
    const rootPool = operationalRecords.length > 0 ? operationalRecords : component;
    const root = rootPool.reduce((best, item) => (item.baseScore > best.baseScore ? item : best), rootPool[0]);

    const strategicRiskLinks: CorrelationStrategicRiskClusterLink[] = component
      .filter((item) => strategicRiskKeys.has(item.recordKey))
      .flatMap((item) => [...(resolvedRiskLinks.get(item.recordKey) ?? [])]
        .filter((sharedRecordKey) => visitedGraphNodes.has(sharedRecordKey))
        .map((sharedRecordKey) => ({ riskRecordKey: item.recordKey, sharedRecordKey })))
      .sort((left, right) =>
        left.riskRecordKey.localeCompare(right.riskRecordKey) || left.sharedRecordKey.localeCompare(right.sharedRecordKey));

    const cluster: CorrelationCluster = {
      clusterKey: `cluster:${root.recordKey}`,
      rootRecordKey: root.recordKey,
      title: root.title,
      records: component,
      categories,
      recordCount: component.length,
      contributingRecordCount: materialRecordCount,
      topScore: root.baseScore,
      strategicRiskLinks,
      contextRecords,
    };
    clusters.push(cluster);
    convergenceByCluster.set(cluster, materialCategories.size);
  });

  const convergentRisks = clusters
    .filter((cluster) =>
      (convergenceByCluster.get(cluster) ?? 0) >= CORRELATION_CONVERGENCE_MIN_CATEGORIES
      && cluster.recordCount >= CORRELATION_CONVERGENCE_MIN_RECORDS
      && cluster.contributingRecordCount >= CORRELATION_CONVERGENCE_MIN_RECORDS)
    .sort((a, b) => b.categories.size - a.categories.size || b.recordCount - a.recordCount || b.topScore - a.topScore);

  const clusterByRecordKey = new Map<string, CorrelationCluster>();
  clusters.forEach((cluster) => {
    cluster.records.forEach((record) => clusterByRecordKey.set(record.recordKey, cluster));
  });

  return { signalled, clusters, convergentRisks, clusterByRecordKey };
}
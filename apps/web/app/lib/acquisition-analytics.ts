import {
  leadSourceOptions,
  type LeadRecord,
  type LeadSource,
} from "./crm";

type AmountParser = (value: string) => number;

export function getWonLeadValue(
  lead: LeadRecord,
  parseAmount: AmountParser,
): number {
  return parseAmount(lead.finalJobValue) || parseAmount(lead.quoteValue);
}

export function isLeadQuoted(lead: LeadRecord): boolean {
  return (
    lead.status === "Quote Sent"
    || lead.status === "Follow-Up"
    || lead.status === "Won"
    || Boolean(lead.quoteSentDate)
  );
}

export function isLeadWon(lead: LeadRecord): boolean {
  return lead.status === "Won";
}

// Evidence describes sample size only, not channel quality or performance.
export function getAcquisitionEvidenceLabel(leadCount: number): string {
  return leadCount >= 6
    ? "Stronger evidence"
    : leadCount >= 3
      ? "Emerging evidence"
      : leadCount >= 1
        ? "Early signal"
        : "";
}

export function buildAcquisitionAnalytics(
  activeLeads: LeadRecord[],
  parseAmount: AmountParser,
) {
  const metricsLeadsGenerated = activeLeads.length;

  const metricsLeadsBySource = leadSourceOptions
    .map((source) => ({
      source,
      count: activeLeads.filter((lead) => lead.sourceChannel === source).length,
    }))
    .filter((entry) => entry.count > 0);

  const metricsJobsWon = activeLeads.filter(isLeadWon).length;

  const metricsQuotesSent = activeLeads.filter(isLeadQuoted).length;

  const metricsLeadToJobConversion = metricsLeadsGenerated === 0
    ? 0
    : (metricsJobsWon / metricsLeadsGenerated) * 100;

  const metricsRevenueFromWonLeads = activeLeads
    .filter(isLeadWon)
    .reduce(
      (total, lead) => total + getWonLeadValue(lead, parseAmount),
      0,
    );

  const metricsAverageJobValue = metricsJobsWon === 0
    ? 0
    : metricsRevenueFromWonLeads / metricsJobsWon;

  const acquisitionChannelPerformance = leadSourceOptions
    .map((channel) => {
      const channelLeads = activeLeads.filter(
        (lead) => lead.sourceChannel === channel,
      );

      const leadCount = channelLeads.length;
      const wonLeads = channelLeads.filter(isLeadWon);
      const jobsWon = wonLeads.length;

      const revenue = wonLeads.reduce(
        (total, lead) => total + getWonLeadValue(lead, parseAmount),
        0,
      );

      return {
        channel,
        leadCount,
        quotesSent: channelLeads.filter(isLeadQuoted).length,
        jobsWon,
        conversionRate: leadCount === 0 ? 0 : (jobsWon / leadCount) * 100,
        revenue,
        averageWonJobValue: jobsWon === 0 ? 0 : revenue / jobsWon,
        evidenceLabel: getAcquisitionEvidenceLabel(leadCount),
      };
    })
    .filter((entry) => entry.leadCount > 0);

  const acquisitionSourceDetailPerformance = Array.from(
    activeLeads.reduce(
      (groups, lead) => {
        const detail = lead.sourceDetail.trim();

        if (!detail) {
          return groups;
        }

        const key = `${lead.sourceChannel}::${detail.toLowerCase()}`;
        const existing = groups.get(key);

        if (existing) {
          existing.leads.push(lead);
        } else {
          groups.set(key, {
            sourceDetail: detail,
            sourceChannel: lead.sourceChannel,
            leads: [lead],
          });
        }

        return groups;
      },
      new Map<
        string,
        {
          sourceDetail: string;
          sourceChannel: LeadSource;
          leads: LeadRecord[];
        }
      >(),
    ).values(),
  )
    .map(({ sourceDetail, sourceChannel, leads: detailLeads }) => {
      const leadCount = detailLeads.length;
      const wonLeads = detailLeads.filter(isLeadWon);
      const jobsWon = wonLeads.length;

      const revenue = wonLeads.reduce(
        (total, lead) => total + getWonLeadValue(lead, parseAmount),
        0,
      );

      return {
        sourceDetail,
        sourceChannel,
        leadCount,
        jobsWon,
        conversionRate: leadCount === 0 ? 0 : (jobsWon / leadCount) * 100,
        revenue,
        evidenceLabel: getAcquisitionEvidenceLabel(leadCount),
      };
    })
    .sort(
      (first, second) =>
        second.leadCount - first.leadCount
        || first.sourceDetail.localeCompare(second.sourceDetail),
    );

  return {
    metricsLeadsGenerated,
    metricsLeadsBySource,
    metricsJobsWon,
    metricsQuotesSent,
    metricsLeadToJobConversion,
    metricsRevenueFromWonLeads,
    metricsAverageJobValue,
    acquisitionChannelPerformance,
    acquisitionSourceDetailPerformance,
  };
}

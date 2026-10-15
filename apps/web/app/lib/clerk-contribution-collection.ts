import "server-only";
import { resolveClerkSession } from "./clerk-session-resolver";
import {
  createContributionCollectionPreviewAuthority, type ContributionCollectionDependencies,
} from "./contribution-collection-workflow";

export function createClerkContributionCollectionPreview(
  infrastructure: Omit<ContributionCollectionDependencies, "resolveSession">,
) {
  return createContributionCollectionPreviewAuthority({
    ...infrastructure, resolveSession: resolveClerkSession,
  });
}

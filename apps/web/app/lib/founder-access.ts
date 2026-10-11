export function isAuthorizedFounder(
  authenticatedUserId: string | null,
  configuredFounderId: string | undefined,
): boolean {
  return (
    typeof authenticatedUserId === "string" &&
    typeof configuredFounderId === "string" &&
    configuredFounderId.startsWith("user_") &&
    configuredFounderId.length > 15 &&
    authenticatedUserId === configuredFounderId
  );
}

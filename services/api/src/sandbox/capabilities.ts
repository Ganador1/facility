export const NESTED_DOCKER_SETUP_KEY = "nested_docker";

/**
 * Existing profiles predate capability flags and ran with nested Docker on AWS.
 * Preserve that behavior unless a trusted profile explicitly disables it.
 * Invalid persisted JSON also stays on the legacy, fully exercised boundary
 * instead of silently selecting the new fast path; API writes reject invalid
 * values before they reach storage.
 */
export function nestedDockerEnabled(setup: unknown): boolean {
  if (!setup || typeof setup !== "object" || Array.isArray(setup)) return true;
  const value = (setup as Record<string, unknown>)[NESTED_DOCKER_SETUP_KEY];
  return typeof value === "boolean" ? value : true;
}

export function nestedDockerSettingIsValid(setup: Record<string, unknown>): boolean {
  return (
    !Object.hasOwn(setup, NESTED_DOCKER_SETUP_KEY) ||
    typeof setup[NESTED_DOCKER_SETUP_KEY] === "boolean"
  );
}

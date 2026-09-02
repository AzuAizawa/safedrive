export const TRANSIENT_JWT_CLOCK_SKEW_RETRY_MS = 1500;

export const isTransientJwtClockSkewError = (error: unknown) =>
  error instanceof Error && /jwt issued at future/i.test(error.message);

export const signInWithTransientJwtRetry = async <T extends { error: Error | null }>(
  attempt: () => Promise<T>,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
) => {
  let result = await attempt();
  if (!isTransientJwtClockSkewError(result.error)) return result;

  await wait(TRANSIENT_JWT_CLOCK_SKEW_RETRY_MS);
  result = await attempt();
  return result;
};

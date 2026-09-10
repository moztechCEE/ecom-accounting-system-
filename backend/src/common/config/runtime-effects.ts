/** Deployment-only switches. Omission preserves existing production behavior.
 * Read-only canaries explicitly disable both; manual seed jobs are unchanged.
 */
function enabled(name: string, env: NodeJS.ProcessEnv): boolean {
  const value = env[name];
  if (value === undefined || value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

export function seedOnStartupEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return enabled('SEED_ON_STARTUP', env);
}

export function runtimeScheduleOptions(env: NodeJS.ProcessEnv = process.env) {
  const run = enabled('RUNTIME_SCHEDULES_ENABLED', env);
  return { cronJobs: run, intervals: run, timeouts: run };
}

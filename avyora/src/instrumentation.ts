export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startJobScheduler } = await import("@/server/jobs/scheduler");
    startJobScheduler();
  }
}

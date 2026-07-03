import {
  readConfig
} from "./chunk-E4CVFKPO.js";

// src/worker.ts
import PgBoss from "pg-boss";
import pino from "pino";
async function startWorker() {
  const config = readConfig();
  const logger = pino({ level: config.logLevel });
  const boss = new PgBoss({ connectionString: config.databaseUrl });
  boss.on("error", (error) => logger.error({ err: error }, "pg-boss error"));
  await boss.start();
  const queues = [
    "runs.dispatch",
    "watchtower.outcomes",
    "watchtower.health",
    "learning.nightly",
    "fingerprints.verify",
    "hitl.expire"
  ];
  for (const queue of queues) {
    await boss.createQueue(queue);
  }
  for (const queue of queues) {
    await boss.work(queue, async (job) => {
      const jobId = Array.isArray(job) ? job[0]?.id : job.id;
      logger.info({ queue, jobId }, "no-op worker completed job");
    });
  }
  await boss.schedule("hitl.expire", "0 * * * *", {});
  await boss.schedule("watchtower.outcomes", "0 2 * * *", {});
  await boss.schedule("watchtower.health", "0 3 * * *", {});
  await boss.schedule("learning.nightly", "0 4 * * *", {});
  logger.info({ queues }, "facility worker started");
  return boss;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  startWorker().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
export {
  startWorker
};

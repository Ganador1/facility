import PgBoss from 'pg-boss';

declare function startWorker(): Promise<PgBoss>;

export { startWorker };

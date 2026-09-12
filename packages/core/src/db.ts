import pg from "pg";
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  statement_timeout: 10000,
});
export async function tx<T>(
  userId: string,
  workspaceId: string | null,
  run: (c: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(
      "SELECT set_config('app.user_id',$1,true),set_config('app.workspace_id',$2,true)",
      [userId, workspaceId ?? ""],
    );
    const result = await run(c);
    await c.query("COMMIT");
    return result;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
  ) {
    super(code);
  }
}
export const requireRow = <T>(row: T | undefined): T => {
  if (!row) throw new AppError(404, "NOT_FOUND");
  return row;
};

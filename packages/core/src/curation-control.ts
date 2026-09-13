import { tx } from "./db.js";
export async function checkCurationControl(
  owner: string,
  ws: string,
  version: number,
) {
  return tx(owner, ws, async (c) => {
    const row = (
      await c.query(
        "SELECT config,version FROM ai_settings WHERE workspace_id=$1",
        [ws],
      )
    ).rows[0];
    return !!row?.config.enabled && row.version === version;
  });
}
export async function stopForQuota(owner: string, ws: string, version: number) {
  return tx(owner, ws, async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      ws + "settings",
    ]);
    return (
      await c.query(
        "UPDATE ai_settings SET config=jsonb_set(config,'{enabled}','false'),stopped_reason='AI_FREE_QUOTA_EXHAUSTED',stopped_at=now(),version=version+1,updated_at=now() WHERE workspace_id=$1 AND version=$2 RETURNING version",
        [ws, version],
      )
    ).rows[0];
  });
}

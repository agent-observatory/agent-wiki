import { registerUploads } from "./uploads.js";
import { registerAutomation } from "./automation.js";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import oauth2 from "@fastify/oauth2";
import rateLimit from "@fastify/rate-limit";
import { registerKnowledge } from "./knowledge.js";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  pool,
  tx,
  AppError,
  requireRow,
} from "../../../packages/core/src/db.js";
import {
  hash,
  mask,
  putSource,
  getSource,
} from "../../../packages/core/src/storage.js";
import { log } from "../../../packages/core/src/log.js";
import type { FastifyRequest } from "fastify";
const uuid = z.string().uuid();
type Identity = {
  userId: string;
  scope: "session" | "read" | "source:write" | "publish";
  workspaceId?: string;
  tokenHash: string;
};
declare module "fastify" {
  interface FastifyRequest {
    identity?: Identity;
  }
  interface FastifyInstance {
    githubOAuth2: import("@fastify/oauth2").OAuth2Namespace;
  }
}
export async function buildApp() {
  const ownerId = process.env.OWNER_GITHUB_ID?.trim();
  const requireOwner = (id: string) => {
    if (!ownerId) throw new AppError(503, "OWNER_NOT_CONFIGURED");
    if (id !== ownerId) throw new AppError(403, "OWNER_ONLY");
  };
  const app = Fastify({
    bodyLimit: 262144,
    logger: false,
    trustProxy: (_address, hop) => hop === 0,
    requestTimeout: 25000,
    connectionTimeout: 30000,
  });
  let draining = false;
  app.addHook("preClose", async () => {
    draining = true;
  });
  app.addHook("onSend", async (_req, reply, payload) => {
    if (draining) reply.header("Connection", "close");
    return payload;
  });
  await app.register(cookie);
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const secure = appUrl.startsWith("https:");
  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    await app.register(oauth2, {
      name: "githubOAuth2",
      scope: ["read:user"],
      credentials: {
        client: {
          id: process.env.GITHUB_CLIENT_ID,
          secret: process.env.GITHUB_CLIENT_SECRET,
        },
        auth: {
          authorizeHost: "https://github.com",
          authorizePath: "/login/oauth/authorize",
          tokenHost: "https://github.com",
          tokenPath: "/login/oauth/access_token",
        },
      },
      startRedirectPath: "/api/auth/github",
      callbackUri: appUrl + "/api/auth/github/callback",
      pkce: "S256",
      cookie: { secure, sameSite: "lax", httpOnly: true },
    });
    app.get("/api/auth/github/callback", async (req, reply) => {
      const access =
        await app.githubOAuth2.getAccessTokenFromAuthorizationCodeFlow(
          req,
          reply,
        );
      const res = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: "Bearer " + access.token.access_token,
          Accept: "application/vnd.github+json",
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new AppError(502, "GITHUB_UNAVAILABLE");
      const user = (await res.json()) as { id: number; login: string };
      requireOwner(String(user.id));
      await pool.query(
        "INSERT INTO users(id,login) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET login=EXCLUDED.login",
        [String(user.id), user.login],
      );
      const token = randomBytes(32).toString("base64url");
      await pool.query(
        "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '14 days')",
        [hash(token), String(user.id)],
      );
      reply.setCookie("wiki_session", token, {
        httpOnly: true,
        secure,
        sameSite: "lax",
        path: "/",
        maxAge: 14 * 86400,
      });
      return reply.redirect("/");
    });
  }
  app.addHook("onRequest", async (req, reply) => {
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Cache-Control", "no-store");
    if (!ownerId && req.url !== "/healthz" && req.url !== "/readyz")
      throw new AppError(503, "OWNER_NOT_CONFIGURED");
    if (
      req.url === "/healthz" ||
      req.url === "/readyz" ||
      req.url.startsWith("/api/auth/github")
    )
      return;
    const bearer = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
    const token = bearer ?? req.cookies.wiki_session;
    if (!token) throw new AppError(401, "LOGIN_REQUIRED");
    const h = hash(token);
    if (bearer) {
      const row = (
        await pool.query(
          "SELECT user_id,workspace_id,scope FROM api_keys WHERE token_hash=$1",
          [h],
        )
      ).rows[0];
      if (!row) throw new AppError(401, "INVALID_TOKEN");
      req.identity = {
        userId: row.user_id,
        scope: row.scope,
        workspaceId: row.workspace_id,
        tokenHash: h,
      };
    } else {
      const row = (
        await pool.query(
          "SELECT user_id FROM sessions WHERE token_hash=$1 AND expires_at>now()",
          [h],
        )
      ).rows[0];
      if (!row) throw new AppError(401, "SESSION_EXPIRED");
      req.identity = { userId: row.user_id, scope: "session", tokenHash: h };
    }
    requireOwner(req.identity.userId);
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (req.identity.scope === "session" && req.headers.origin !== appUrl)
        throw new AppError(403, "ORIGIN_REJECTED");
      if (!req.headers["content-type"]?.startsWith("application/json"))
        throw new AppError(415, "JSON_REQUIRED");
      if (req.identity.scope === "read")
        throw new AppError(403, "READ_ONLY_TOKEN");
      if (req.identity.scope !== "session") {
        const suffix = req.url.split("?")[0];
        const allowed =
          req.method === "POST" &&
          (/^\/api\/workspaces\/[^/]+\/(?:source-records|collection(?:\/cursor|\/uploads(?:\/[a-f0-9-]+\/(?:complete|parts\/\d+))?)?)$/.test(
            suffix,
          ) ||
            (req.identity.scope === "publish" &&
              /^\/api\/workspaces\/[^/]+\/publications$/.test(suffix)));
        if (!allowed) throw new AppError(403, "SCOPE_REJECTED");
      }
    }
  });
  app.setErrorHandler((err, req, reply) => {
    let status =
      err instanceof AppError
        ? err.statusCode
        : err instanceof z.ZodError
          ? 400
          : ((err as { statusCode?: number }).statusCode ?? 500);
    if (status < 400 || status > 599) status = 500;
    const code =
      err instanceof AppError
        ? err.code
        : err instanceof z.ZodError
          ? "INVALID_INPUT"
          : status === 429
            ? "RATE_LIMITED"
            : status >= 500
              ? "SERVER_ERROR"
              : "REQUEST_ERROR";
    if (status >= 500)
      log("error", "api_server_error", {
        request_id: req.id,
        error_code: code,
      });
    reply.code(status).send({ error: code, requestId: req.id });
  });
  async function scoped<T>(
    req: FastifyRequest,
    run: (c: import("pg").PoolClient, ws: string) => Promise<T>,
  ) {
    const ws = uuid.parse((req.params as { workspaceId: string }).workspaceId);
    const who = req.identity!;
    if (who.workspaceId && who.workspaceId !== ws)
      throw new AppError(404, "NOT_FOUND");
    return tx(who.userId, ws, async (c) => {
      requireRow(
        (await c.query("SELECT id FROM workspaces WHERE id=$1", [ws])).rows[0],
      );
      return run(c, ws);
    });
  }
  const sessionOnly = (req: FastifyRequest) => {
    if (req.identity!.scope !== "session")
      throw new AppError(403, "SESSION_REQUIRED");
  };
  app.get("/healthz", async () => ({ status: "ok" }));
  app.get("/readyz", async () => {
    await pool.query("SELECT 1");
    return { status: "ready" };
  });
  app.get("/api/me", async (req) => ({
    user: requireRow(
      (
        await pool.query("SELECT id,login FROM users WHERE id=$1", [
          req.identity!.userId,
        ])
      ).rows[0],
    ),
    scope: req.identity!.scope,
  }));
  app.post("/api/auth/logout", async (req, reply) => {
    sessionOnly(req);
    await pool.query("DELETE FROM sessions WHERE token_hash=$1", [
      req.identity!.tokenHash,
    ]);
    reply.clearCookie("wiki_session", { path: "/" });
    return { ok: true };
  });
  app.get("/api/workspaces", async (req) =>
    tx(req.identity!.userId, null, async (c) => ({
      items: (
        await c.query(
          "SELECT * FROM workspaces WHERE ($1::uuid IS NULL OR id=$1) ORDER BY created_at",
          [req.identity!.workspaceId ?? null],
        )
      ).rows,
    })),
  );
  app.post("/api/workspaces", async (req) => {
    sessionOnly(req);
    const name = z
      .string()
      .trim()
      .min(1)
      .max(80)
      .parse((req.body as { name: string }).name);
    return tx(
      req.identity!.userId,
      null,
      async (c) =>
        (
          await c.query(
            "INSERT INTO workspaces(id,owner_id,name) VALUES($1,$2,$3) RETURNING *",
            [randomUUID(), req.identity!.userId, name],
          )
        ).rows[0],
    );
  });
  registerKnowledge(app, scoped, sessionOnly, appUrl);
  registerAutomation(app, scoped, sessionOnly);
  registerUploads(app, scoped);
  app.get("/api/workspaces/:workspaceId/keys", async (req) => {
    sessionOnly(req);
    return scoped(req, async (c, ws) => ({
      items: (
        await c.query(
          "SELECT id,name,scope,created_at FROM api_keys WHERE user_id=$1 AND workspace_id=$2",
          [req.identity!.userId, ws],
        )
      ).rows,
    }));
  });
  app.post("/api/workspaces/:workspaceId/keys", async (req) => {
    sessionOnly(req);
    const input = z
      .object({
        name: z.string().min(1).max(80),
        scope: z.enum(["read", "source:write", "publish"]).default("read"),
      })
      .parse(req.body);
    return scoped(req, async (c, ws) => {
      const token = "aw_" + randomBytes(32).toString("base64url");
      const row = (
        await c.query(
          "INSERT INTO api_keys(id,user_id,workspace_id,token_hash,name,scope) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,name,scope",
          [
            randomUUID(),
            req.identity!.userId,
            ws,
            hash(token),
            input.name,
            input.scope,
          ],
        )
      ).rows[0];
      return { ...row, token };
    });
  });
  app.delete("/api/workspaces/:workspaceId/keys/:id", async (req) => {
    sessionOnly(req);
    return scoped(req, async (c, ws) => {
      await c.query(
        "DELETE FROM api_keys WHERE workspace_id=$1 AND id=$2 AND user_id=$3",
        [
          ws,
          uuid.parse((req.params as { id: string }).id),
          req.identity!.userId,
        ],
      );
      return { ok: true };
    });
  });
  return app;
}

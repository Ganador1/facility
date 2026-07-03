import { orgs } from "@facility/db";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ensureDevUser, mintSessionCookie } from "../app.js";
import { ApiError } from "../errors.js";
import type { AppConfig } from "../types.js";

const EmptyResponse = z.object({ ok: z.boolean() });

export async function registerAuthRoutes(app: FastifyInstance, config: AppConfig) {
  app.get(
    "/auth/login",
    {
      config: { public: true },
      schema: { response: { 302: z.unknown(), 501: z.object({ error: z.unknown() }) } },
    },
    async (_request, reply) => {
      if (!config.workosClientId) {
        throw new ApiError(501, "workos_unconfigured", "WorkOS login is not configured");
      }
      const redirectUri = `${config.publicUrl}/auth/callback`;
      const url = new URL("https://api.workos.com/user_management/authorize");
      url.searchParams.set("client_id", config.workosClientId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("response_type", "code");
      return reply.redirect(url.toString());
    },
  );

  app.get(
    "/auth/callback",
    {
      config: { public: true },
      schema: {
        querystring: z.object({ code: z.string().optional() }),
        response: { 302: z.unknown(), 501: z.object({ error: z.unknown() }) },
      },
    },
    async () => {
      throw new ApiError(
        501,
        "workos_unconfigured",
        "WorkOS callback exchange is not configured in this build",
      );
    },
  );

  app.post(
    "/auth/dev-login",
    {
      config: { public: true },
      schema: {
        body: z.object({ email: z.string().email() }),
        response: {
          200: z.object({ ok: z.boolean(), orgId: z.string(), userId: z.string() }),
        },
      },
    },
    async (request, reply) => {
      if (!config.facilityInsecureDev) {
        throw new ApiError(404, "not_found", "Dev login is disabled");
      }
      const { email } = request.body as { email: string };
      const session = await ensureDevUser(app.facilityDb, email);
      const sealed = await mintSessionCookie(config, session.userId, session.orgId);
      reply.setCookie("facility_session", sealed, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        signed: true,
        secure: false,
      });
      await request.audit("auth.login", { type: "user", id: session.userId });
      return { ok: true, ...session };
    },
  );

  app.post(
    "/auth/logout",
    {
      config: { public: true },
      schema: { response: { 200: EmptyResponse } },
    },
    async (request, reply) => {
      if (request.principal) {
        await request.audit("auth.logout", {
          type: request.principal.type,
          id: request.principal.id,
        });
      }
      reply.clearCookie("facility_session", { path: "/" });
      return { ok: true };
    },
  );

  app.get(
    "/auth/default-org",
    {
      config: { permission: "org:read" },
      schema: { response: { 200: z.object({ id: z.string(), slug: z.string() }) } },
    },
    async (request) => {
      const principal = request.principal;
      if (!principal) throw new ApiError(401, "unauthorized", "Authentication required");
      const org = (
        await app.facilityDb.select().from(orgs).where(eq(orgs.id, principal.orgId)).limit(1)
      )[0];
      if (!org) throw new ApiError(404, "not_found", "Organization not found");
      return { id: org.id, slug: org.slug };
    },
  );
}

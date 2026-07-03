import { inboundEvents } from "@facility/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveGithubIntegration } from "../github/processor.js";
import { parseGithubJson, verifyGithubSignature } from "../github/webhook.js";
import type { AppConfig } from "../types.js";

const Ok = z.object({ ok: z.boolean(), replayed: z.boolean().optional() });

export async function registerWebhookRoutes(app: FastifyInstance, config: AppConfig) {
  await app.register(async (webhookApp) => {
    webhookApp.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (_request, body, done) => done(null, body),
    );

    webhookApp.post(
      "/webhooks/github",
      {
        config: { public: true },
        schema: { response: { 202: Ok, 401: Ok } },
      },
      async (request, reply) => {
        const secret = config.githubAppWebhookSecret;
        if (!secret) return reply.status(401).send({ ok: false });
        const rawBody = Buffer.isBuffer(request.body) ? request.body : Buffer.from("");
        const signature = request.headers["x-hub-signature-256"];
        if (
          !verifyGithubSignature(
            rawBody,
            Array.isArray(signature) ? signature[0] : signature,
            secret,
          )
        ) {
          return reply.status(401).send({ ok: false });
        }
        const delivery = request.headers["x-github-delivery"];
        const eventType = request.headers["x-github-event"];
        if (typeof delivery !== "string" || typeof eventType !== "string") {
          return reply.status(401).send({ ok: false });
        }
        const payload = parseGithubJson(rawBody) as Record<string, unknown>;
        const integration = await resolveGithubIntegration(app.facilityDb, payload);
        const id = `gh_${delivery}`;
        const inserted = await app.facilityDb
          .insert(inboundEvents)
          .values({
            id,
            orgId: integration.orgId,
            integrationId: integration.integrationId,
            verified: true,
            eventType,
            payload,
          })
          .onConflictDoNothing()
          .returning();
        if (inserted.length === 0) return reply.status(202).send({ ok: true, replayed: true });
        await app.enqueue("github.webhook", { inboundEventId: id });
        return reply.status(202).send({ ok: true });
      },
    );
  });
}

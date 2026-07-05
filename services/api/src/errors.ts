import type { FastifyReply } from "fastify";

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function sendError(reply: FastifyReply, error: ApiError) {
  // Never leak internal detail on 5xx, even for an intentional ApiError — log it
  // and return a generic body. 4xx client errors still surface their message.
  if (error.statusCode >= 500) {
    reply.log.error({ err: error }, "server error");
    return reply
      .status(error.statusCode)
      .send({ error: { code: "internal_error", message: "Internal server error" } });
  }
  return reply.status(error.statusCode).send({
    error: { code: error.code, message: error.message, details: error.details },
  });
}

export const notFound = (message = "Not found") => new ApiError(404, "not_found", message);

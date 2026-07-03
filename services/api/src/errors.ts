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
  return reply.status(error.statusCode).send({
    error: { code: error.code, message: error.message, details: error.details },
  });
}

export const notFound = (message = "Not found") => new ApiError(404, "not_found", message);

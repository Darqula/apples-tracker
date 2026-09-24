import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export class HttpError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function registerErrorHandler(
  app: FastifyInstance,
  options?: { notFoundHandler?: (request: FastifyRequest, reply: FastifyReply) => unknown },
) {
  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.status).send({
        error: { code: err.code, message: err.message },
      });
    }

    if ('validation' in (err as Record<string, unknown>) && Array.isArray((err as { validation: unknown }).validation)) {
      const validationError = err as unknown as { message: string };
      return reply.status(400).send({
        error: { code: "VALIDATION", message: validationError.message },
      });
    }

    const statusCode = (err as { statusCode?: unknown }).statusCode;
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
      const clientError = err as unknown as { message: string };
      return reply.status(statusCode).send({
        error: { code: "BAD_REQUEST", message: clientError.message },
      });
    }

    app.log.error(err);
    return reply.status(500).send({
      error: { code: "INTERNAL", message: "Internal server error" },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    // When web serving is enabled the handler falls back to index.html for
    // non-API GET paths; otherwise it stays the plain JSON 404.
    if (options?.notFoundHandler) {
      return options.notFoundHandler(request, reply);
    }

    return reply.status(404).send({
      error: { code: "NOT_FOUND", message: "Route not found" },
    });
  });
}

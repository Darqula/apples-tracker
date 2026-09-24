import type { FastifyInstance } from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";

export async function registerOpenApi(app: FastifyInstance): Promise<void> {
  app.register(swagger, {
    openapi: {
      info: {
        title: "Apples Tracker API",
        version: "0.1.0",
        description:
          "Personal job-application tracker. Manage companies and job postings as they move through " +
          "application stages (saved, applied, screening, interview, offer, rejected, withdrawn, ghosted), " +
          "and keep one shared context note. " +
          "An AI usage guide for tools consuming this API is available at GET /api/guide. " +
          "Note: the `q` search parameter matches only the job title and the company name — " +
          "it never matches the posting description or the AI context notes.",
      },
      servers: [{ url: "http://127.0.0.1:3001" }],
      tags: [
        { name: "Companies", description: "Create, list, inspect, update and delete companies" },
        { name: "Postings", description: "Manage job postings and track their application state" },
        { name: "Context", description: "One shared, free-form context note" },
        { name: "Meta", description: "API health, AI usage guide and the OpenAPI document itself" },
      ],
    },
  });

  app.register(swaggerUi, { routePrefix: "/docs" });

  app.get("/openapi.json", { schema: { hide: true } }, async () => app.swagger());
}

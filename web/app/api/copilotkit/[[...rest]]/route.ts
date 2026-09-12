// CopilotKit runtime. Optional catch-all so it serves both /api/copilotkit (the GraphQL POST)
// and sub-paths the client probes, e.g. GET /api/copilotkit/info.
import { CopilotRuntime, OpenAIAdapter, copilotRuntimeNextJSAppRouterEndpoint } from "@copilotkit/runtime";
import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const key = process.env.OPENROUTER_API_KEY;

function handler() {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime: new CopilotRuntime(),
    serviceAdapter: new OpenAIAdapter({
      openai: new OpenAI({
        apiKey: key ?? "missing",
        baseURL: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
      }),
      model: process.env.OPENROUTER_MODEL ?? "openrouter/free",
    } as any),
    endpoint: "/api/copilotkit",
  });
  return handleRequest;
}

export const POST = async (req: Request) => {
  if (!key) {
    return new Response(JSON.stringify({ error: "OPENROUTER_API_KEY not set" }), {
      status: 503, headers: { "content-type": "application/json" },
    });
  }
  return handler()(req);
};

export const GET = async (req: Request) => handler()(req);

// CopilotKit runtime, pointed at OpenRouter so the sidebar and the swarm workers share a provider.
import { CopilotRuntime, OpenAIAdapter, copilotRuntimeNextJSAppRouterEndpoint } from "@copilotkit/runtime";
import OpenAI from "openai";

export const runtime = "nodejs";

const key = process.env.OPENROUTER_API_KEY;

export const POST = async (req: Request) => {
  if (!key) {
    return new Response(JSON.stringify({ error: "OPENROUTER_API_KEY not set" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime: new CopilotRuntime(),
    serviceAdapter: new OpenAIAdapter({
      openai: new OpenAI({ apiKey: key, baseURL: "https://openrouter.ai/api/v1" }),
      model: process.env.OPENROUTER_MODEL ?? "anthropic/claude-3.5-sonnet",
    } as any),
    endpoint: "/api/copilotkit",
  });
  return handleRequest(req);
};

// CopilotKit runtime. Optional catch-all so it serves /api/copilotkit and the client's
// GET /api/copilotkit/info probe.
//
// Env names: this project has three naming conventions live in Vercel
// (OPENROUTER_*, OPENROUTE_* and LLM_*), so read all of them.
import { CopilotRuntime, OpenAIAdapter, copilotRuntimeNextJSAppRouterEndpoint } from "@copilotkit/runtime";
import OpenAI from "openai";
import { copilotProvider, modelFetch } from "@/lib/copilot-provider.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const env = process.env;
const provider = copilotProvider(env);

function handler() {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime: new CopilotRuntime(),
    serviceAdapter: new OpenAIAdapter({
      openai: new OpenAI({ apiKey: provider?.apiKey ?? "missing", baseURL: provider?.baseURL, fetch: modelFetch(), timeout: 90000 }),
      model: provider?.model,
      disableParallelToolCalls: true,
    } as any),
    endpoint: "/api/copilotkit",
  });
  return handleRequest;
}

export const POST = async (req: Request) => {
  if (!provider) {
    return new Response(
      JSON.stringify({
        error: "no API key",
        checked: ["OPENROUTER_API_KEY", "OPENROUTE_API_KEY", "LLM_API_KEY"],
        seen: Object.keys(env).filter((k) => /OPENROUT|LLM_/.test(k)),
      }),
      { status: 503, headers: { "content-type": "application/json" } },
    );
  }
  return handler()(req);
};

export const GET = async (req: Request) => handler()(req);

// CopilotKit runtime. Optional catch-all so it serves /api/copilotkit and the client's
// GET /api/copilotkit/info probe.
//
// Env names: this project has three naming conventions live in Vercel
// (OPENROUTER_*, OPENROUTE_* and LLM_*), so read all of them.
import { CopilotRuntime, OpenAIAdapter, copilotRuntimeNextJSAppRouterEndpoint } from "@copilotkit/runtime";
import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const env = process.env;
const KEY   = env.OPENROUTER_API_KEY  ?? env.OPENROUTE_API_KEY  ?? env.LLM_API_KEY;
const BASE  = env.OPENROUTER_BASE_URL ?? env.OPENROUTE_BASE_URL ?? env.LLM_BASE_URL ?? "https://openrouter.ai/api/v1";
const MODEL = env.OPENROUTER_MODEL    ?? env.OPENROUTE_MODEL    ?? env.LLM_MODEL    ?? "openrouter/free";

function handler() {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime: new CopilotRuntime(),
    serviceAdapter: new OpenAIAdapter({
      openai: new OpenAI({ apiKey: KEY ?? "missing", baseURL: BASE }),
      model: MODEL,
    } as any),
    endpoint: "/api/copilotkit",
  });
  return handleRequest;
}

export const POST = async (req: Request) => {
  if (!KEY) {
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

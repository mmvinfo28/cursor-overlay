// CopilotKit runtime. Points OpenAIAdapter at OpenRouter, so the sidebar and the swarm workers
// run through the same provider (and the same sponsor).
import { CopilotRuntime, OpenAIAdapter, copilotRuntimeNextJSAppRouterEndpoint } from '@copilotkit/runtime';
import OpenAI from 'openai';

export const runtime = 'nodejs';

const key = process.env.OPENROUTER_API_KEY;

const openai = new OpenAI({
  apiKey: key ?? 'missing',
  baseURL: 'https://openrouter.ai/api/v1',
});

const serviceAdapter = new OpenAIAdapter({
  openai,
  model: process.env.OPENROUTER_MODEL ?? 'anthropic/claude-3.5-sonnet',
} as any);

export const POST = async (req: Request) => {
  if (!key) {
    return new Response(
      JSON.stringify({ error: 'OPENROUTER_API_KEY not set - the dashboard still works, only the copilot is off' }),
      { status: 503, headers: { 'content-type': 'application/json' } },
    );
  }
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime: new CopilotRuntime(),
    serviceAdapter,
    endpoint: '/api/copilotkit',
  });
  return handleRequest(req);
};

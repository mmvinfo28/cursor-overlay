// One small question — "is this a task, and what's its title?" — against whichever provider is configured.
// Order: generic OpenAI-compatible (LLM_BASE_URL/LLM_API_KEY/LLM_MODEL — the hackathon Qwen endpoint,
// OpenRouter, Groq, a local vLLM…), then OpenRouter, OpenAI, Anthropic, Gemini by their own keys.

export type Proposal = { propose: boolean; title?: string; reason?: string; provider?: string };

const SYSTEM = (app: string) =>
  `You watch text a user is typing in ${app}. ` +
  `If it contains a concrete commitment or task an AI crew could do for them (make a file, research, draft, code), ` +
  `answer {"propose":true,"title":"<imperative, max 8 words>"}. Otherwise {"propose":false}. Most messages are not tasks. JSON only.`;

function parse(raw: string | null | undefined): Proposal {
  const m = String(raw ?? "").match(/\{[\s\S]*?\}/);
  if (!m) return { propose: false };
  try {
    const out = JSON.parse(m[0]);
    return { propose: !!out.propose, title: out.title ? String(out.title).slice(0, 80) : undefined };
  } catch {
    return { propose: false };
  }
}

type Provider = { name: string; run: (text: string, app: string) => Promise<Proposal> };

function openaiCompatible(name: string, baseUrl: string, key: string, model: string): Provider {
  return {
    name,
    async run(text, app) {
      const body: Record<string, unknown> = {
        model, temperature: 0, max_tokens: 120,
        messages: [{ role: "system", content: SYSTEM(app) }, { role: "user", content: text }],
      };
      if (/qwen/i.test(model)) body.chat_template_kwargs = { enable_thinking: false };   // Qwen3 would spend the budget thinking
      const r = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!r.ok) return { propose: false, reason: `${name} ${r.status}` };
      const j = await r.json();
      return parse(j.choices?.[0]?.message?.content);
    },
  };
}

function anthropic(key: string, model: string): Provider {
  return {
    name: "anthropic",
    async run(text, app) {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
        body: JSON.stringify({ model, max_tokens: 120, temperature: 0, system: SYSTEM(app), messages: [{ role: "user", content: text }] }),
      });
      if (!r.ok) return { propose: false, reason: `anthropic ${r.status}` };
      const j = await r.json();
      return parse(j.content?.[0]?.text);
    },
  };
}

function gemini(key: string, model: string): Provider {
  return {
    name: "gemini",
    async run(text, app) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM(app) }] }, contents: [{ parts: [{ text }] }], generationConfig: { temperature: 0, maxOutputTokens: 120 } }),
      });
      if (!r.ok) return { propose: false, reason: `gemini ${r.status}` };
      const j = await r.json();
      return parse(j.candidates?.[0]?.content?.parts?.[0]?.text);
    },
  };
}

export function providers(): Provider[] {
  const e = process.env;
  const list: Provider[] = [];
  if (e.LLM_BASE_URL && e.LLM_API_KEY) list.push(openaiCompatible("llm", e.LLM_BASE_URL, e.LLM_API_KEY, e.LLM_MODEL || "qwen3.8-27b"));
  const orKey = e.OPENROUTER_API_KEY || e.OPENROUTE_API_KEY;
  if (orKey) list.push(openaiCompatible("openrouter", "https://openrouter.ai/api/v1", orKey, e.PROPOSE_MODEL || "openai/gpt-4o-mini"));
  if (e.OPENAI_API_KEY) list.push(openaiCompatible("openai", "https://api.openai.com/v1", e.OPENAI_API_KEY, e.OPENAI_MODEL || "gpt-4o-mini"));
  if (e.ANTHROPIC_API_KEY) list.push(anthropic(e.ANTHROPIC_API_KEY, e.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001"));
  if (e.GEMINI_API_KEY) list.push(gemini(e.GEMINI_API_KEY, e.GEMINI_MODEL || "gemini-2.0-flash"));
  return list;
}

// first provider that answers wins; a provider that errors passes the turn to the next one
export async function propose(text: string, app: string): Promise<Proposal> {
  const list = providers();
  if (!list.length) return { propose: false, reason: "no provider configured" };
  const reasons: string[] = [];
  for (const p of list) {
    try {
      const out = await p.run(text, app);
      if (out.reason) { reasons.push(out.reason); continue; }
      return { ...out, provider: p.name };
    } catch (err) {
      reasons.push(`${p.name} ${(err as Error).message}`);
    }
  }
  return { propose: false, reason: reasons.join("; ") };
}

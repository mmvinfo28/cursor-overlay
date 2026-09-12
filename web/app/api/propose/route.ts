import { NextResponse } from "next/server";

// Body: { text, app } → { propose: boolean, title?: string }
// The overlay calls this after its local filter passes. Without OPENROUTER_API_KEY it stays silent.
const MODEL = process.env.PROPOSE_MODEL || "openai/gpt-4o-mini";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body?.text) return NextResponse.json({ propose: false });
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return NextResponse.json({ propose: false, reason: "no OPENROUTER_API_KEY" });

  const system =
    `You watch text a user is typing in ${body.app || "an app"}. ` +
    `If it contains a concrete commitment or task an AI crew could do for them (make a file, research, draft, code), ` +
    `answer {"propose":true,"title":"<imperative, max 8 words>"}. Otherwise {"propose":false}. Most messages are not tasks. JSON only.`;

  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      max_tokens: 60,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: String(body.text).slice(0, 1500) },
      ],
    }),
  });
  if (!r.ok) return NextResponse.json({ propose: false, reason: `openrouter ${r.status}` });
  const j = await r.json();
  try {
    const out = JSON.parse(j.choices[0].message.content);
    return NextResponse.json({ propose: !!out.propose, title: out.title ? String(out.title).slice(0, 80) : undefined });
  } catch {
    return NextResponse.json({ propose: false });
  }
}

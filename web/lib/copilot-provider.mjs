// Keep credentials, endpoint and model from the same provider family.
export function copilotProvider(env) {
  if (env.LLM_API_KEY) return { apiKey: env.LLM_API_KEY, baseURL: env.LLM_BASE_URL || 'https://api.openai.com/v1', model: env.LLM_MODEL || 'gpt-4o-mini' };
  for (const prefix of ['OPENROUTER', 'OPENROUTE']) {
    if (env[`${prefix}_API_KEY`]) return { apiKey: env[`${prefix}_API_KEY`], baseURL: env[`${prefix}_BASE_URL`] || 'https://openrouter.ai/api/v1', model: env[`${prefix}_MODEL`] || 'openrouter/free' };
  }
  return null;
}

export function modelFetch(fetcher = fetch) {
  return (url, init) => {
    if (typeof init?.body === 'string' && String(url).includes('/chat/completions')) {
      const body = JSON.parse(init.body);
      if (/qwen/i.test(body.model || '')) {
        body.chat_template_kwargs = { enable_thinking: false };
        init = { ...init, body: JSON.stringify(body) };
      }
    }
    return fetcher(url, init);
  };
}

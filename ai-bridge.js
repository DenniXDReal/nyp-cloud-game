/* Compatibility for the published Unity build. Provider credentials stay on Cloud Run. */
(() => {
  'use strict';
  const backend = 'https://nyp-game-ai-jx6fyzmahq-as.a.run.app';
  const originalFetch = globalThis.fetch.bind(globalThis);
  let sessionId = crypto.randomUUID();

  globalThis.fetch = async function gameFetch(input, options) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
    if (url.origin !== 'https://openrouter.ai' || url.pathname !== '/api/v1/chat/completions') {
      return originalFetch(input, options);
    }
    const legacy = new Request(input, options);
    const data = JSON.parse(await legacy.text());
    const messages = (data.messages || []).filter(message => message.role === 'user' || message.role === 'assistant');
    const latest = messages.pop();
    if (!latest || latest.role !== 'user') throw new Error('Missing player message');
    if (!messages.length) sessionId = crypto.randomUUID();
    const match = /^\[Current Trust: (\d+)\/100 \| Previous Topic: "(.*)"\]\r?\nVisitor: "([\s\S]*)"$/.exec(latest.content);
    const response = await originalFetch(`${backend}/v1/turn`, {
      method: 'POST', signal: legacy.signal, credentials: 'omit',
      // Discard the old build's Authorization and HTTP-Referer headers.
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: crypto.randomUUID(), sessionId,
        playerText: match ? match[3] : latest.content,
        currentTrust: match ? Number(match[1]) : 10,
        lockedReason: match && match[2] !== 'NONE' ? match[2] : '',
        history: messages.slice(-8).map(({ role, content }) => ({ role, content })),
      }),
    });
    const frames = (await response.text()).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    const final = frames.at(-1);
    if (!response.ok || final?.type !== 'result') {
      console.warn('Game AI unavailable:', final?.code || response.status);
      return new Response(JSON.stringify({ error: { message: final?.code || 'ai_temporarily_unavailable' } }),
        { status: response.ok ? 503 : response.status, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ choices: [{ message: {
      role: 'assistant', content: JSON.stringify(final.response),
    } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
})();

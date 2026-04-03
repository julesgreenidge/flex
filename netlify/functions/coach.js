exports.handler = async function(event) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const body = JSON.parse(event.body);
        const { system, messages, mode } = body;

        // Jumi routine generation uses Sonnet + web search
        // Chat mode uses Haiku (cheaper, no search needed)
        const isJumiGen = mode === 'jumi_generate';

        const requestBody = {
            model: isJumiGen ? 'claude-sonnet-4-5' : 'claude-haiku-4-5-20251001',
            max_tokens: isJumiGen ? 4000 : 1000,
            system,
            messages
        };

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('Anthropic API error:', JSON.stringify(data));
            return {
                statusCode: response.status,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reply: `API error ${response.status}: ${data.error?.message || JSON.stringify(data)}` })
            };
        }

        // Extract text from all content blocks (handles tool use interleaving)
        let reply = '';
        if (data.content && Array.isArray(data.content)) {
            for (const block of data.content) {
                if (block.type === 'text') {
                    reply += block.text;
                }
            }
        }
        reply = reply.trim();

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reply })
        };
    } catch (err) {
        console.error('Function error:', err);
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reply: `Function error: ${err.message}` })
        };
    }
};

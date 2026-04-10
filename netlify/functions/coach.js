exports.handler = async function(event) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const body = JSON.parse(event.body);
        const { system, messages, mode } = body;

        const isJumiGen = mode === 'jumi_generate';
        const isChat = mode === 'jumi_chat';

        // Tool definition for structured routine output
        const generateRoutineTool = {
            name: 'generate_routine',
            description: 'Output a structured flexibility routine. Call this whenever you generate a routine for the user. The routine data is separate from your explanation — put your explanation in your text response, and the routine data in this tool call.',
            input_schema: {
                type: 'object',
                properties: {
                    hold: {
                        type: 'string',
                        enum: ['short', 'long'],
                        description: 'Hold duration type for the routine'
                    },
                    'Warm-Up': { type: 'array', items: { '$ref': '#/$defs/exercise' } },
                    'Foam Roller': { type: 'array', items: { '$ref': '#/$defs/exercise' } },
                    'Mobility': { type: 'array', items: { '$ref': '#/$defs/exercise' } },
                    'Static Stretching': { type: 'array', items: { '$ref': '#/$defs/exercise' } },
                    'Active Stretch': { type: 'array', items: { '$ref': '#/$defs/exercise' } },
                    'Deep Stretch': { type: 'array', items: { '$ref': '#/$defs/exercise' } },
                    'Splits': { type: 'array', items: { '$ref': '#/$defs/exercise' } },
                    'Cool Down': { type: 'array', items: { '$ref': '#/$defs/exercise' } },
                },
                required: ['hold'],
                '$defs': {
                    exercise: {
                        type: 'object',
                        properties: {
                            exercise: { type: 'string', description: 'Exact exercise name from library' },
                            target: { type: 'string', description: 'Target muscle group' },
                            position: { type: 'string', description: 'Body position' },
                            sides: { type: 'number', enum: [1, 2], description: '1 for bilateral, 2 for unilateral' },
                            bodyPart: { type: 'string', enum: ['upper', 'lower', 'full'] }
                        },
                        required: ['exercise', 'target', 'position', 'sides', 'bodyPart']
                    }
                }
            }
        };

        const tools = [generateRoutineTool];

        // Add web search for chat mode
        if (isChat) {
            tools.push({ type: 'web_search_20250305', name: 'web_search' });
        }

        const requestBody = {
            model: 'claude-haiku-4-5-20251001',
            max_tokens: isJumiGen ? 4000 : 2000,
            system,
            messages,
            tools
        };

        // Force tool use for generate mode
        if (isJumiGen) {
            requestBody.tool_choice = { type: 'any' };
        }

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01',
                'anthropic-beta': 'web-search-2025-03-05'
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

        // Extract text and routine tool call separately
        let reply = '';
        let routine = null;

        if (data.content && Array.isArray(data.content)) {
            for (const block of data.content) {
                if (block.type === 'text') {
                    reply += block.text;
                } else if (block.type === 'tool_use' && block.name === 'generate_routine') {
                    routine = block.input;
                }
            }
        }
        reply = reply.trim();

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reply, routine })
        };
    } catch (err) {
        console.error('Function error:', err);
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reply: `Function error: ${err.message}`, routine: null })
        };
    }
};

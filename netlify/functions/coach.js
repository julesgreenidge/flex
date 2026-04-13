exports.handler = async function(event) {
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: corsHeaders, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers: corsHeaders, body: 'Method Not Allowed' };
    }

    try {
        const body = JSON.parse(event.body);
        const { system, messages, mode } = body;

        const isJumiGen = mode === 'jumi_generate';
        const isChat = mode === 'jumi_chat';

        // Tool definition for structured routine output
        // Phase names use snake_case (API requirement: no spaces in property keys)
        // Mapped back to display names before returning
        const PHASE_MAP = {
            warm_up: 'Warm-Up',
            foam_roller: 'Foam Roller',
            mobility: 'Mobility',
            static_stretching: 'Static Stretching',
            active_stretch: 'Active Stretch',
            deep_stretch: 'Deep Stretch',
            splits: 'Splits',
            cool_down: 'Cool Down'
        };

        const phaseSchema = { type: 'array', items: {
            type: 'object',
            properties: {
                exercise: { type: 'string', description: 'Exact exercise name from library' },
                target: { type: 'string', description: 'Target muscle group' },
                position: { type: 'string', description: 'Body position' },
                sides: { type: 'number', description: '1 for bilateral, 2 for unilateral (each side separately)' },
                bodyPart: { type: 'string', enum: ['upper', 'lower', 'full'] }
            },
            required: ['exercise', 'target', 'position', 'sides', 'bodyPart']
        }};

        const generateRoutineTool = {
            name: 'generate_routine',
            description: 'Output a structured flexibility routine. Call this whenever you generate a routine for the user. Put your explanation in your text response, and the routine data in this tool call.',
            input_schema: {
                type: 'object',
                properties: {
                    hold: { type: 'string', enum: ['short', 'long'], description: 'Hold duration type' },
                    body_type: { type: 'string', enum: ['full', 'upper', 'lower'], description: 'Body type: full, upper, or lower body' },
                    warm_up:           phaseSchema,
                    foam_roller:       phaseSchema,
                    mobility:          phaseSchema,
                    static_stretching: phaseSchema,
                    active_stretch:    phaseSchema,
                    deep_stretch:      phaseSchema,
                    splits:            phaseSchema,
                    cool_down:         phaseSchema,
                },
                required: ['hold']
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

        // Encourage tool use for generate mode but don't force it (allows text explanation through)
        if (isJumiGen) {
            requestBody.tool_choice = { type: 'auto' };
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
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
                    // Map snake_case keys back to display phase names
                    const raw = block.input;
                    routine = { hold: raw.hold };
                    for (const [snake, display] of Object.entries(PHASE_MAP)) {
                        if (raw[snake] && raw[snake].length > 0) {
                            routine[display] = raw[snake];
                        }
                    }
                }
            }
        }
        reply = reply.trim();

        return {
            statusCode: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ reply, routine })
        };
    } catch (err) {
        console.error('Function error:', err);
        return {
            statusCode: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ reply: `Function error: ${err.message}`, routine: null })
        };
    }
};

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
        const isAuthor = mode === 'jumi_author'; // new: no tools, plain JSON response

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

        const PRIORITY_TARGET_ENUM = [
            'Hips', 'Hamstrings', 'Quads', 'Glutes', 'Spine', 'Shoulders',
            'Calves', 'Adductors', 'Abductors', 'Back', 'Ankles', 'Chest', 'Obliques'
        ];

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
            description: 'Output a structured flexibility routine with explicit priorities that drove the selection. Always include 1-2 priorities.',
            input_schema: {
                type: 'object',
                properties: {
                    priorities: {
                        type: 'array',
                        description: 'The 1-2 explicit decisions that drove exercise selection for this routine. Must always be provided. Each priority must have an action (increase or reduce) and a target from the fixed enum.',
                        minItems: 1,
                        maxItems: 2,
                        items: {
                            type: 'object',
                            properties: {
                                action: { type: 'string', enum: ['increase', 'reduce'], description: 'Whether to increase or reduce this target' },
                                target: { type: 'string', enum: PRIORITY_TARGET_ENUM, description: 'The muscle group or area being prioritised' }
                            },
                            required: ['action', 'target']
                        }
                    },
                    warm_up:           phaseSchema,
                    foam_roller:       phaseSchema,
                    mobility:          phaseSchema,
                    static_stretching: phaseSchema,
                    active_stretch:    phaseSchema,
                    deep_stretch:      phaseSchema,
                    splits:            phaseSchema,
                    cool_down:         phaseSchema,
                },
                required: ['priorities']
            }
        };

        const tools = isAuthor ? [] : isChat ? [] : [generateRoutineTool];

        // Add web search for chat mode
        if (isChat) {
            tools.push({ type: 'web_search_20250305', name: 'web_search' });
        }

        const requestBody = {
            model: (isAuthor || isChat) ? 'claude-sonnet-4-20250514' : 'claude-haiku-4-5-20251001',
            max_tokens: isAuthor ? 8000 : isChat ? 4000 : isJumiGen ? 4000 : 2000,
            system,
            messages,
        };

        // Only add tools if we have any
        if (tools.length > 0) {
            requestBody.tools = tools;
        }

        // Encourage tool use for generate mode but don't force it
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

        // Extract text, routine, and priorities from tool call
        let reply = '';
        let routine = null;
        let priorities = [];

        if (data.content && Array.isArray(data.content)) {
            for (const block of data.content) {
                if (block.type === 'text') {
                    reply += block.text;
                } else if (block.type === 'tool_use' && block.name === 'generate_routine') {
                    const raw = block.input;

                    // Extract priorities — handle both object format {action, target} and string format "increase Quads"
                    if (Array.isArray(raw.priorities)) {
                        priorities = raw.priorities.map(p => {
                            // Already correct object format
                            if (p && typeof p === 'object' && p.action && p.target) return p;
                            // String format: "increase Quads" or "reduce Spine"
                            if (typeof p === 'string') {
                                const match = p.match(/^(increase|reduce)\s+(.+)$/i);
                                if (match) return { action: match[1].toLowerCase(), target: match[2].trim() };
                            }
                            return null;
                        }).filter(p =>
                            p &&
                            (p.action === 'increase' || p.action === 'reduce') &&
                            PRIORITY_TARGET_ENUM.includes(p.target)
                        ).slice(0, 2);
                    }

                    // Extract routine phases
                    routine = {};
                    for (const snake of Object.keys(PHASE_MAP)) {
                        if (raw[snake] && raw[snake].length > 0) {
                            routine[snake] = raw[snake];
                        }
                    }
                }
            }
        }
        reply = reply.trim();

        return {
            statusCode: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ reply, routine, priorities })
        };
    } catch (err) {
        console.error('Function error:', err);
        return {
            statusCode: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ reply: `Function error: ${err.message}`, routine: null, priorities: [] })
        };
    }
};

import OpenAI from 'openai';
import 'dotenv/config';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1'
});

export async function askOpenAI(parsed: any): Promise<string> {
    const content = `
System: ${parsed.system}
Actors: ${parsed.actors.join(', ')}
Control Actions: ${parsed.controlActions.join(', ')}
Hazards: ${parsed.hazards.join(', ')}
Losses: ${parsed.losses.join(', ')}
UCAs: ${parsed.ucas.join(', ')}

Based on this STPA model, what might be a next step in the analysis?
`;

    const res = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
            { role: 'system', content: 'You are a helpful STPA safety assistant.' },
            { role: 'user', content }
        ]
    });

    return res.choices[0].message?.content?.trim() || 'No response.';
}

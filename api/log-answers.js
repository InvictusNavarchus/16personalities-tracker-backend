// api/log-answers.js
import { neon } from '@neondatabase/serverless';

// Initialize Neon SQL client using the DATABASE_URL environment variable
// This should be done outside the handler for potential reuse, though neon() is lightweight.
const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
    // --- CORS Headers ---
    res.setHeader('Access-Control-Allow-Origin', 'https://www.16personalities.com');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle OPTIONS preflight request
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // --- Method Check ---
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST', 'OPTIONS']);
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    // --- Data Processing ---
    try {
        const payload = req.body;

        // --- Basic Validation ---
        if (!payload || typeof payload !== 'object') {
             return res.status(400).json({ message: 'Invalid payload format. Expected JSON object.' });
        }

        const { type, userId, sessionId, timestamp } = payload;

        if (!userId || !sessionId || !timestamp || typeof userId !== 'string' || typeof sessionId !== 'string' || typeof timestamp !== 'string') {
             return res.status(400).json({ message: 'Missing or invalid required fields: userId (string), sessionId (string), timestamp (string)' });
        }

        // --- Handle Different Payload Types ---
        // UPDATED: Check for both 'test_started' and 'test_finished'
        if (type === 'event' && (payload.eventName === 'test_started' || payload.eventName === 'test_finished')) {
            console.log(`Logging ${payload.eventName} event via HTTP for User: ${userId}, Session: ${sessionId}`);
            try {
                // Assuming you have a table named 'test_events'
                await sql`
                    INSERT INTO test_events (user_id, session_id, event_name, event_timestamp)
                    VALUES (${userId}, ${sessionId}, ${payload.eventName}, ${timestamp})
                `;
                console.log(`${payload.eventName} event inserted successfully.`);
            } catch (dbError) {
                console.error(`Database error logging ${payload.eventName} event:`, dbError);
                // Decide if this failure should stop the process or just be logged
                // For events, maybe just log and continue?
            }
            // Send success response even if DB logging had an issue (optional, depends on requirements)
            return res.status(200).json({ message: `${payload.eventName} event received (logged server-side)` });

        } else if (type === 'answers') {
            // --- Log Answers (No changes needed here) ---
            const answers = payload.answers;

            if (!Array.isArray(answers) || answers.length === 0) {
                return res.status(400).json({ message: 'Missing or empty "answers" array.' });
            }

            // --- Database Insertion using Transaction ---
            // Prepare queries for the transaction
            const queries = answers.map(answer => {
                // Validate each answer object before creating the query
                if (answer.question_number === undefined || answer.question_number === null || !answer.question_text || answer.answer_value === undefined) {
                     // Throw an error that will be caught by the outer try...catch
                     throw new Error(`Invalid answer format in array: ${JSON.stringify(answer)}`);
                }
                // Use SQL template literal for safety and readability
                return sql`
                    INSERT INTO test_answers
                        (user_id, session_id, question_number, question_text, answer_value, answer_label, event_timestamp)
                    VALUES
                        (${userId}, ${sessionId}, ${answer.question_number}, ${answer.question_text}, ${answer.answer_value}, ${answer.answer_label}, ${timestamp})
                `;
            });

            // Execute all insert queries within a single HTTP transaction
            await sql.transaction(queries);

            console.log(`Successfully inserted ${answers.length} answers via HTTP transaction for User: ${userId}, Session: ${sessionId}`);
            return res.status(201).json({ message: `Successfully logged ${answers.length} answers.` });

        } else {
             return res.status(400).json({ message: 'Invalid payload type specified.' });
        }

    } catch (error) {
        console.error('Error processing request:', error);

        // Differentiate validation errors from potential database/server errors
        if (error.message.startsWith('Invalid answer format') || error.message.startsWith('Missing')) {
             return res.status(400).json({ message: 'Data validation failed', error: error.message });
        }

        // Handle potential Neon DB errors (e.g., connection, SQL syntax) or other server issues
        // Check if the error object has specific properties if Neon driver provides them
         return res.status(500).json({ message: 'Internal Server Error processing request.', error: error.message });
    }
}
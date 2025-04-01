// api/log-answers.js
import { neon } from '@neondatabase/serverless';

// Initialize Neon SQL client using the DATABASE_URL environment variable
// This should be done outside the handler for potential reuse, though neon() is lightweight.
const sql = neon(process.env.DATABASE_URL);

// Helper function for simple validation of the traits object in the result payload - NEW HELPER
function isValidTraitObject(traits) {
    if (!traits || typeof traits !== 'object') return false;
    const requiredTraits = ['mind', 'energy', 'nature', 'tactics', 'identity'];
    for (const trait of requiredTraits) {
        if (
            !traits[trait] || // Check if trait exists
            typeof traits[trait].percent !== 'number' || // Check percent is number
            traits[trait].percent < 0 || traits[trait].percent > 100 || // Check range
            typeof traits[trait].type !== 'string' || // Check type is string
            traits[trait].type.trim() === '' // Check type is not empty
        ) {
            console.warn(`Trait validation failed for: ${trait}`, traits[trait]); // Add warning for debugging
            return false; // Failed validation
        }
    }
    return true; // All required traits are valid
}


export default async function handler(req, res) {
    // --- CORS Headers ---
    res.setHeader('Access-Control-Allow-Origin', 'https://www.16personalities.com');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

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

        // Validate common required fields
        if (!userId || !sessionId || !timestamp || typeof userId !== 'string' || typeof sessionId !== 'string' || typeof timestamp !== 'string') {
            return res.status(400).json({ message: 'Missing or invalid required fields: userId (string), sessionId (string), timestamp (string)' });
        }

        // --- Handle Different Payload Types ---
        // UPDATED: Check for both 'test_started' and 'test_finished'
        if (type === 'event' && (payload.eventName === 'test_started' || payload.eventName === 'test_finished')) {
            // --- Log Event --- // New sub-section comment for clarity
            console.log(`Logging ${payload.eventName} event via HTTP for User: ${userId}, Session: ${sessionId}`);
            try {
                // Assuming you have a table named 'test_events'
                await sql`
                    INSERT INTO test_events (user_id, session_id, event_name, event_timestamp)
                    VALUES (${userId}, ${sessionId}, ${payload.eventName}, ${timestamp}::timestamptz) -- Added explicit timestamp cast
                `;
                console.log(`${payload.eventName} event inserted successfully.`);
                // Send success response for event logging
                return res.status(200).json({ message: `${payload.eventName} event received (logged server-side)` }); // Updated message slightly

            } catch (dbError) {
                console.error(`Database error logging ${payload.eventName} event:`, dbError);
                // Decide if this failure should stop the process or just be logged
                // For events, maybe just log and continue?
                return res.status(500).json({ message: `Error logging ${payload.eventName} event`, error: dbError.message }); // Return 500 on DB error
            }

        } else if (type === 'answers') {
            // --- Log Answers (No changes needed here in terms of DB schema from original) ---
            const answers = payload.answers;

            if (!Array.isArray(answers) || answers.length === 0) {
                return res.status(400).json({ message: 'Missing or empty "answers" array.' });
            }

            // --- Database Insertion using Transaction ---
            try { // Added try block specifically for transaction logic
                console.log(`Attempting to insert ${answers.length} answers via HTTP transaction for User: ${userId}, Session: ${sessionId}`); // Added log message
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
                             (${userId}, ${sessionId}, ${answer.question_number}, ${answer.question_text}, ${answer.answer_value}, ${answer.answer_label || 'N/A'}, ${timestamp}::timestamptz) -- Added explicit timestamp cast
                     `;
                 });

                 // Execute all insert queries within a single HTTP transaction provided by Neon // Updated comment for Neon context
                 await sql.transaction(queries);

                 console.log(`Successfully inserted ${answers.length} answers via HTTP transaction for User: ${userId}, Session: ${sessionId}`);
                 return res.status(201).json({ message: `Successfully logged ${answers.length} answers.` });

             } catch(validationError) { // Catch validation errors from the map() specifically
                  console.error('Validation error preparing answer insert:', validationError);
                  return res.status(400).json({ message: 'Data validation failed for answers', error: validationError.message });
             } catch (dbError) { // Catch database transaction errors
                  console.error('Database transaction error inserting answers:', dbError);
                  return res.status(500).json({ message: 'Database error inserting answers', error: dbError.message });
             }

        } else if (type === 'result') { // --- NEW: Handle Result Payload ---
            const { profileUrl, mbtiResult, mbtiCode, traits } = payload;

            // Validate result data - NEW VALIDATION
            if (!profileUrl || typeof profileUrl !== 'string' || !profileUrl.startsWith('https://www.16personalities.com/profiles/')) {
                 return res.status(400).json({ message: 'Missing or invalid profileUrl format.' });
            }
            if (!mbtiResult || typeof mbtiResult !== 'string') {
                 return res.status(400).json({ message: 'Missing or invalid mbtiResult (full string).' });
            }
            // mbtiCode is optional in payload, so only check if present
            if (mbtiCode && typeof mbtiCode !== 'string') {
                return res.status(400).json({ message: 'Invalid mbtiCode format (should be string or null).' });
            }
            if (!isValidTraitObject(traits)) { // Use helper for validation
                 console.error("Invalid traits object received:", traits); // Log for debugging
                 return res.status(400).json({ message: 'Invalid or incomplete traits object.' });
            }

            console.log(`Logging test result for User: ${userId}, Session: ${sessionId}, Result: ${mbtiResult}`); // NEW Log

            try { // Database operation in try block
                // Assuming a table named 'test_results' exists with the correct columns - NEW ASSUMPTION
                await sql`
                    INSERT INTO test_results (
                        user_id, session_id, mbti_result_full, mbti_code, profile_url,
                        mind_percent, mind_type,
                        energy_percent, energy_type,
                        nature_percent, nature_type,
                        tactics_percent, tactics_type,
                        identity_percent, identity_type,
                        result_timestamp -- Use the timestamp from the payload
                    ) VALUES (
                        ${userId}, ${sessionId}, ${mbtiResult}, ${mbtiCode || null}, ${profileUrl},
                        ${traits.mind.percent}, ${traits.mind.type},
                        ${traits.energy.percent}, ${traits.energy.type},
                        ${traits.nature.percent}, ${traits.nature.type},
                        ${traits.tactics.percent}, ${traits.tactics.type},
                        ${traits.identity.percent}, ${traits.identity.type},
                        ${timestamp}::timestamptz -- Cast payload timestamp
                    )
                `;
                console.log(`Test result inserted successfully for User: ${userId}, Session: ${sessionId}`); // NEW Log
                return res.status(201).json({ message: 'Test result logged successfully.' }); // NEW Success message
            } catch (dbError) {
                console.error('Database error inserting test result:', dbError); // NEW Log
                return res.status(500).json({ message: 'Database error inserting test result', error: dbError.message }); // NEW Error message
            }

        } else {
            // --- Unknown Payload Type ---
            return res.status(400).json({ message: `Invalid payload type specified: '${type}'` }); // Adjusted message slightly
        }

    } catch (error) {
        // --- General Error Handling ---
        console.error('Error processing request:', error);

        // Differentiate validation errors from potential database/server errors
        if (error.message.startsWith('Invalid answer format') || error.message.startsWith('Missing') || error instanceof SyntaxError) { // Combined checks
            return res.status(400).json({ message: 'Data validation or parsing failed', error: error.message }); // Adjusted message slightly
        }

        // Handle potential Neon DB errors (e.g., connection, SQL syntax) or other server issues
        // Check if the error object has specific properties if Neon driver provides them
         return res.status(500).json({ message: 'Internal Server Error processing request.', error: error.message });
    }
}
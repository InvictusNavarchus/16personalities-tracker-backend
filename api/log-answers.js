import { neon } from '@neondatabase/serverless';

// ===== DATABASE CONNECTION =====
const sql = neon(process.env.DATABASE_URL);

// ===== VALIDATION HELPERS =====
function validateCommonFields(payload) {
  const { userId, sessionId, timestamp } = payload;
  
  if (!userId || typeof userId !== 'string') {
    throw new ValidationError('Missing or invalid userId (string required)');
  }
  
  if (!sessionId || typeof sessionId !== 'string') {
    throw new ValidationError('Missing or invalid sessionId (string required)');
  }
  
  if (!timestamp || typeof timestamp !== 'string') {
    throw new ValidationError('Missing or invalid timestamp (string required)');
  }
  
  return { userId, sessionId, timestamp };
}

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
      console.warn(`Trait validation failed for: ${trait}`, traits[trait]);
      return false; // Failed validation
    }
  }
  return true; // All required traits are valid
}

function validateAnswers(answers) {
  if (!Array.isArray(answers) || answers.length === 0) {
    throw new ValidationError('Missing or empty "answers" array');
  }
  
  answers.forEach(answer => {
    if (
      answer.question_number === undefined || 
      answer.question_number === null || 
      !answer.question_text || 
      answer.answer_value === undefined
    ) {
      throw new ValidationError(
        `Invalid answer format in array: ${JSON.stringify(answer)}`
      );
    }
  });
  
  return answers;
}

function validateTestResult(payload) {
  const { profileUrl, mbtiResult, mbtiCode, traits } = payload;
  
  if (!profileUrl || typeof profileUrl !== 'string' || 
      !profileUrl.startsWith('https://www.16personalities.com/profiles/')) {
    throw new ValidationError('Missing or invalid profileUrl format');
  }
  
  if (!mbtiResult || typeof mbtiResult !== 'string') {
    throw new ValidationError('Missing or invalid mbtiResult (full string)');
  }
  
  if (mbtiCode && typeof mbtiCode !== 'string') {
    throw new ValidationError('Invalid mbtiCode format (should be string or null)');
  }
  
  if (!isValidTraitObject(traits)) {
    console.error("Invalid traits object received:", traits);
    throw new ValidationError('Invalid or incomplete traits object');
  }
  
  return { profileUrl, mbtiResult, mbtiCode, traits };
}

// ===== HANDLER FUNCTIONS =====
async function handleEvent(payload, res) {
  const { userId, sessionId, timestamp } = validateCommonFields(payload);
  const { eventName } = payload;
  
  console.log(`Logging ${eventName} event via HTTP for User: ${userId}, Session: ${sessionId}`);
  
  try {
    await sql`
      INSERT INTO test_events (user_id, session_id, event_name, event_timestamp)
      VALUES (${userId}, ${sessionId}, ${eventName}, ${timestamp}::timestamptz)
    `;
    
    console.log(`${eventName} event inserted successfully.`);
    return res.status(200).json({ 
      message: `${eventName} event received (logged server-side)` 
    });
  } catch (dbError) {
    console.error(`Database error logging ${eventName} event:`, dbError);
    return res.status(500).json({ 
      message: `Error logging ${eventName} event`, 
      error: dbError.message 
    });
  }
}

async function handleAnswers(payload, res) {
  const { userId, sessionId, timestamp } = validateCommonFields(payload);
  const answers = validateAnswers(payload.answers);
  
  try {
    console.log(`Validating and preparing ${answers.length} answers for User: ${userId}, Session: ${sessionId}`);
    
    const queries = answers.map(answer => {
      return sql`
        INSERT INTO test_answers
          (user_id, session_id, question_number, question_text, answer_value, answer_label, event_timestamp)
        VALUES
          (${userId}, ${sessionId}, ${answer.question_number}, ${answer.question_text}, 
           ${answer.answer_value}, ${answer.answer_label || 'N/A'}, ${timestamp}::timestamptz)
      `;
    });
    
    console.log("Answer validation and query preparation successful.");
    console.log(`Attempting database transaction for ${queries.length} answers...`);
    
    await sql.transaction(queries);
    
    console.log(`Successfully inserted ${answers.length} answers via HTTP transaction for User: ${userId}, Session: ${sessionId}`);
    return res.status(201).json({ message: `Successfully logged ${answers.length} answers.` });
  } catch (error) {
    console.error('Error handling answers:', error);
    return res.status(500).json({ 
      message: 'Database error inserting answers', 
      error: error.message 
    });
  }
}

async function handleTestResult(payload, res) {
  const { userId, sessionId, timestamp } = validateCommonFields(payload);
  const { profileUrl, mbtiCode, traits } = validateTestResult(payload);
  
  console.log(`Logging test result for User: ${userId}, Session: ${sessionId}, Result: ${mbtiCode}`);
  
  try {
    await sql`
      INSERT INTO test_results (
        user_id, session_id, mbti_type, profile_url,
        mind_percent, mind_type,
        energy_percent, energy_type,
        nature_percent, nature_type,
        tactics_percent, tactics_type,
        identity_percent, identity_type,
        result_timestamp
      ) VALUES (
        ${userId}, ${sessionId}, ${mbtiCode}, ${profileUrl},
        ${traits.mind.percent}, ${traits.mind.type},
        ${traits.energy.percent}, ${traits.energy.type},
        ${traits.nature.percent}, ${traits.nature.type},
        ${traits.tactics.percent}, ${traits.tactics.type},
        ${traits.identity.percent}, ${traits.identity.type},
        ${timestamp}::timestamptz
      )
    `;
    
    console.log(`Test result inserted successfully for User: ${userId}, Session: ${sessionId}`);
    return res.status(201).json({ message: 'Test result logged successfully.' });
  } catch (dbError) {
    console.error('Database error inserting test result:', dbError);
    return res.status(500).json({ 
      message: 'Database error inserting test result', 
      error: dbError.message 
    });
  }
}

// ===== CORS HANDLING =====
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.16personalities.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}

function handlePreflight(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  return false;
}

// ===== ERROR CLASSES =====
class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

// ===== MAIN HANDLER =====
export default async function handler(req, res) {
  // Set CORS headers for all responses
  setCorsHeaders(res);
  
  // Handle preflight requests
  if (handlePreflight(req, res)) {
    return;
  }
  
  // Validate request method
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST', 'OPTIONS']);
    return res.status(405).json({ message: 'Method Not Allowed' });
  }
  
  try {
    const payload = req.body;
    
    // Basic payload validation
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ 
        message: 'Invalid payload format. Expected JSON object.' 
      });
    }
    
    // Route to appropriate handler based on payload type
    const { type } = payload;
    
    if (type === 'event' && (payload.eventName === 'test_started' || payload.eventName === 'test_finished')) {
      return await handleEvent(payload, res);
    } 
    else if (type === 'answers') {
      return await handleAnswers(payload, res);
    } 
    else if (type === 'result') {
      return await handleTestResult(payload, res);
    } 
    else {
      return res.status(400).json({ 
        message: `Invalid payload type specified: '${type}'` 
      });
    }
  } 
  catch (error) {
    console.error('Error processing request:', error);
    
    // Handle validation errors
    if (error instanceof ValidationError) {
      return res.status(400).json({ 
        message: 'Data validation failed', 
        error: error.message 
      });
    }
    
    // Handle JSON parsing errors
    if (error instanceof SyntaxError) {
      return res.status(400).json({ 
        message: 'Invalid JSON format', 
        error: error.message 
      });
    }
    
    // Handle all other errors
    return res.status(500).json({ 
      message: 'Internal Server Error processing request.', 
      error: error.message 
    });
  }
}
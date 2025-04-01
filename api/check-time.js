export default function handler(req, res) {
    // Set CORS headers to allow access from specific origins
    res.setHeader('Access-Control-Allow-Origin', 'https://www.16personalities.com');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
    // Handle OPTIONS preflight request
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }
  
    // Only allow GET requests
    if (req.method !== 'GET') {
      res.setHeader('Allow', ['GET', 'OPTIONS']);
      return res.status(405).json({ message: 'Method Not Allowed' });
    }
  
    // Get the current server time
    const now = new Date();
  
    // Create a response with various time formats and diagnostic info
    const response = {
      status: 'online',
      time: {
        iso: now.toISOString(),
        utc: now.toUTCString(),
        local: now.toString(),
        unixTimestamp: Math.floor(now.getTime() / 1000)
      },
      serverInfo: {
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        nodeVersion: process.version,
        env: process.env.NODE_ENV || 'development'
      }
    };
  
    // Return the response
    return res.status(200).json(response);
  }
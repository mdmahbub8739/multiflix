import { createClient } from '@libsql/client/web';

export default {
  async fetch(request, env) {
    // 1. CORS Headers (Security)
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    };

    // Handle Preflight Options
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // 2. Database Connection
    const client = createClient({
      url: env.TURSO_URL,
      authToken: env.TURSO_TOKEN,
    });

    const url = new URL(request.url);
    const ADMIN_KEY = "12345"; // Admin Password

    try {
      // --- PUBLIC ROUTES ---

      // Route: Get Content
      if (request.method === 'GET' && url.pathname === '/content') {
        const { rows } = await client.execute("SELECT * FROM content ORDER BY created_at DESC LIMIT 100");
        return new Response(JSON.stringify(rows), { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }

      // Route: Search
      if (request.method === 'GET' && url.pathname === '/search') {
        const q = url.searchParams.get('q');
        const { rows } = await client.execute({
          sql: "SELECT * FROM content WHERE title LIKE ? LIMIT 20",
          args: [`%${q}%`]
        });
        return new Response(JSON.stringify(rows), { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }

      // Route: Request Movie
      if (request.method === 'POST' && url.pathname === '/request') {
        const body = await request.json();
        try {
            await client.execute({
                sql: "INSERT INTO requests (title, type) VALUES (?, ?)",
                args: [body.title, body.type || 'movie']
            });
        } catch(e) {
            // Table missing or error, ignore to keep app running
        }
        return new Response(JSON.stringify({ success: true }), { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }

      // --- ADMIN ROUTES ---

      if (url.pathname === '/manage') {
        if (request.headers.get('Admin-Key') !== ADMIN_KEY) {
            return new Response("Unauthorized", { status: 401, headers: corsHeaders });
        }
        
        // Add Content
        if (request.method === 'POST') {
          const body = await request.json();
          await client.execute({
            sql: "INSERT INTO content (tmdb_id, title, type, overview, resources, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            args: [body.tmdbId, body.title, body.type, body.overview, JSON.stringify(body.resources), Date.now()]
          });
          return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        }
        
        // Delete Content
        if (request.method === 'DELETE') {
            const id = url.searchParams.get('id');
            await client.execute({ sql: "DELETE FROM content WHERE id = ?", args: [id] });
            return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        }
      }

      return new Response("Not Found", { status: 404, headers: corsHeaders });

    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
    }
  }
};
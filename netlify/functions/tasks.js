// netlify/functions/tasks.js
export async function handler(event) {
  // CORS
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }),
      };
    }

    const body =
      event.httpMethod === "POST"
        ? JSON.parse(event.body || "{}")
        : {};

    const action = (body.action || (event.queryStringParameters?.action) || "get").toLowerCase();
    const telegramId = body.telegramId || event.queryStringParameters?.telegramId;
    const date = body.date || event.queryStringParameters?.date;

    if (!telegramId || !date) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "telegramId and date are required" }),
      };
    }

    const baseHeaders = {
      "Content-Type": "application/json",
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    };

    // GET tasks
    if (event.httpMethod === "GET" || action === "get") {
      const url =
        `${SUPABASE_URL}/rest/v1/planner_tasks` +
        `?select=tasks` +
        `&telegram_id=eq.${encodeURIComponent(String(telegramId))}` +
        `&date=eq.${encodeURIComponent(String(date))}` +
        `&limit=1`;

      const r = await fetch(url, { method: "GET", headers: baseHeaders });
      const txt = await r.text();

      if (!r.ok) {
        return {
          statusCode: r.status,
          headers: corsHeaders,
          body: JSON.stringify({ error: "Supabase GET failed", details: txt }),
        };
      }

      const rows = txt ? JSON.parse(txt) : [];
      const tasks = rows?.[0]?.tasks ?? [];

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ tasks }),
      };
    }

    // SAVE tasks (UPSERT)
    if (event.httpMethod === "POST" && action === "save") {
      const tasksArr = Array.isArray(body.tasks) ? body.tasks : [];

      const upsertUrl =
        `${SUPABASE_URL}/rest/v1/planner_tasks` +
        `?on_conflict=telegram_id,date`;

      const payload = [{
        telegram_id: String(telegramId),
        date: String(date),
        tasks: tasksArr,
        updated_at: new Date().toISOString(),
      }];

      const r = await fetch(upsertUrl, {
        method: "POST",
        headers: {
          ...baseHeaders,
          // ключевое: UPSERT, а не INSERT
          Prefer: "resolution=merge-duplicates,return=representation",
        },
        body: JSON.stringify(payload),
      });

      const txt = await r.text();

      if (!r.ok) {
        return {
          statusCode: r.status,
          headers: corsHeaders,
          body: JSON.stringify({ error: "Supabase UPSERT failed", details: txt }),
        };
      }

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ ok: true }),
      };
    }

    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Unknown action" }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: String(e?.message || e) }),
    };
  }
}

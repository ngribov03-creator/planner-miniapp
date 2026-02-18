// netlify/functions/tasks.js
import crypto from "crypto";

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

// Telegram initData validation (WebApp)
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
function validateTelegramInitData(initData, botToken) {
  if (!initData) return false;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return false;
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const computedHash = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");

  return computedHash === hash;
}

async function supabaseRequest(path, method, serviceKey, url, body) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "apikey": serviceKey,
      "Authorization": `Bearer ${serviceKey}`,
      "Prefer": "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!res.ok) {
    throw new Error(typeof data === "string" ? data : (data?.message || "Supabase error"));
  }
  return data;
}

export async function handler(event) {
  try {
    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TELEGRAM_BOT_TOKEN } = process.env;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(500, { error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in Netlify env vars" });
    }
    if (!TELEGRAM_BOT_TOKEN) {
      return json(500, { error: "Missing TELEGRAM_BOT_TOKEN in Netlify env vars" });
    }

    const payload = JSON.parse(event.body || "{}");
    const { initData, telegramId, action, date, tasks } = payload;

    if (!validateTelegramInitData(initData, TELEGRAM_BOT_TOKEN)) {
      return json(401, { error: "Invalid Telegram initData" });
    }
    if (!telegramId || telegramId === "guest") {
      return json(400, { error: "telegramId missing" });
    }
    if (!date) {
      return json(400, { error: "date missing" });
    }

    // TABLE: planner_tasks (telegram_id text, date text, tasks jsonb, updated_at timestamptz)
    // PK: (telegram_id, date)

    if (action === "get") {
      const rows = await supabaseRequest(
        `planner_tasks?telegram_id=eq.${encodeURIComponent(telegramId)}&date=eq.${encodeURIComponent(date)}&select=tasks`,
        "GET",
        SUPABASE_SERVICE_ROLE_KEY,
        SUPABASE_URL
      );
      const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
      return json(200, { tasks: row?.tasks || [] });
    }

    if (action === "save") {
      if (!Array.isArray(tasks)) return json(400, { error: "tasks must be an array" });

      const upsertBody = {
        telegram_id: telegramId,
        date,
        tasks,
        updated_at: new Date().toISOString(),
      };

      // upsert by PK
      await supabaseRequest(
        `planner_tasks?on_conflict=telegram_id,date`,
        "POST",
        SUPABASE_SERVICE_ROLE_KEY,
        SUPABASE_URL,
        upsertBody
      );

      return json(200, { ok: true });
    }

    return json(400, { error: "Unknown action" });
  } catch (e) {
    return json(500, { error: e.message || "Server error" });
  }
}

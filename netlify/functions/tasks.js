// netlify/functions/tasks.js
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

// --- Telegram initData validation (HMAC-SHA256) ---
function parseInitData(initData) {
  const params = new URLSearchParams(initData);
  const obj = {};
  for (const [k, v] of params.entries()) obj[k] = v;
  return obj;
}

function buildDataCheckString(fields) {
  // Exclude hash, sort by key, join "key=value" with \n
  return Object.keys(fields)
    .filter((k) => k !== "hash")
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join("\n");
}

function validateTelegramInitData(initData, botToken) {
  if (!initData || typeof initData !== "string") return false;

  const data = parseInitData(initData);
  const receivedHash = data.hash;
  if (!receivedHash) return false;

  const dataCheckString = buildDataCheckString(data);

  // secret_key = HMAC key: SHA256(botToken) as per Telegram docs
  const secretKey = crypto.createHash("sha256").update(botToken).digest();

  const computedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  // constant-time compare
  const a = Buffer.from(computedHash, "hex");
  const b = Buffer.from(receivedHash, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function json(statusCode, bodyObj) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      // If you later need CORS for non-Telegram testing, uncomment:
      // "Access-Control-Allow-Origin": "*",
      // "Access-Control-Allow-Headers": "Content-Type",
      // "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
    body: JSON.stringify(bodyObj),
  };
}

exports.handler = async (event) => {
  // If you later need OPTIONS for CORS:
  // if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: { ... } };

  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json(500, { error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in Netlify env vars" });
  }
  if (!TELEGRAM_BOT_TOKEN) {
    return json(500, { error: "Missing TELEGRAM_BOT_TOKEN in Netlify env vars" });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const { initData, telegramId, action, date, tasks } = payload;

  if (!telegramId || typeof telegramId !== "string") {
    return json(400, { error: "telegramId is required" });
  }
  if (!action || typeof action !== "string") {
    return json(400, { error: "action is required" });
  }
  if (!date || typeof date !== "string") {
    return json(400, { error: "date is required (YYYY-MM-DD)" });
  }

  // Validate Telegram initData
  const ok = validateTelegramInitData(initData, TELEGRAM_BOT_TOKEN);
  if (!ok) {
    return json(401, { error: "Invalid Telegram initData" });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  try {
    if (action === "get") {
      const { data, error } = await supabase
        .from("planner_tasks")
        .select("tasks")
        .eq("telegram_id", telegramId)
        .eq("date", date)
        .maybeSingle();

      if (error) return json(500, { error: error.message });

      return json(200, { tasks: data?.tasks ?? [] });
    }

    if (action === "save") {
      if (!Array.isArray(tasks)) {
        return json(400, { error: "tasks must be an array" });
      }

      const row = {
        telegram_id: telegramId,
        date,
        tasks,
        updated_at: new Date().toISOString(),
      };

      // ✅ КЛЮЧЕВОЕ: UPSERT вместо INSERT
      const { error } = await supabase
        .from("planner_tasks")
        .upsert(row, { onConflict: "telegram_id,date" });

      if (error) return json(500, { error: error.message });

      return json(200, { ok: true });
    }

    return json(400, { error: "Unknown action. Use 'get' or 'save'." });
  } catch (e) {
    return json(500, { error: e?.message || "Server error" });
  }
};

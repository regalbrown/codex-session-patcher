const INTENT_TYPES = {
  ads: "广告位出租",
  development: "项目开发合作",
  token_supply: "AI 中转站 Token 批发供应",
  other: "其他",
};

const STATUSES = new Set(["new", "contacted", "closed"]);
const AD_TABS = [
  ["enhance", "增强"],
  ["settings", "设置"],
  ["help", "帮助"],
  ["cooperation", "合作"],
];
const AD_POSITIONS = [
  ["left", "左侧"],
  ["right", "右侧"],
];
const AD_TAB_VALUES = new Set(AD_TABS.map(([value]) => value));
const AD_POSITION_VALUES = new Set(AD_POSITIONS.map(([value]) => value));
const AD_FITS = new Set(["natural", "contain", "cover", "fill"]);
const DEFAULT_AD_WIDTH = "clamp(190px, 17vw, 320px)";
const DEFAULT_AD_MAX_HEIGHT = "72vh";
const DEFAULT_AD_BACKGROUND = "var(--color-bg-1)";
const MAX_AD_IMAGE_BYTES = 5 * 1024 * 1024;
const AD_IMAGE_EXTENSIONS = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};
const RATE_WINDOW_SECONDS = 60;
const RATE_MAX = 3;
const UNSAFE_TEXT_PATTERNS = [
  /<\s*\/?\s*[a-z][^>]*>/i,
  /\bon[a-z]+\s*=/i,
  /\bjavascript\s*:/i,
  /\bdata\s*:\s*text\/html/i,
];

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};

export async function handleRequest(request, env) {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(request, env) });
  }

  const adAssetMatch = url.pathname.match(/^\/api\/sources\/([^/]+)\/ad-assets\/(.+)$/);
  if (adAssetMatch && request.method === "GET") {
    return serveAdAsset(request, env, decodeURIComponent(adAssetMatch[1]), adAssetMatch[2]);
  }

  const publicAdSlotsMatch = url.pathname.match(/^\/api\/sources\/([^/]+)\/ad-slots$/);
  if (publicAdSlotsMatch && request.method === "GET") {
    return getPublicAdSlots(request, env, decodeURIComponent(publicAdSlotsMatch[1]));
  }

  const sourceMatch = url.pathname.match(/^\/api\/sources\/([^/]+)\/intents$/);
  if (sourceMatch && request.method === "POST") {
    return submitIntent(request, env, decodeURIComponent(sourceMatch[1]));
  }

  if (url.pathname === "/admin" && request.method === "GET") {
    return html(adminPage());
  }

  if (url.pathname === "/api/admin/login" && request.method === "POST") {
    return adminLogin(request, env);
  }

  if (url.pathname === "/api/admin/intents" && request.method === "GET") {
    const auth = requireAdmin(request, env);
    if (auth) return auth;
    return listIntents(request, env);
  }

  if (url.pathname === "/api/admin/ad-slots" && request.method === "GET") {
    const auth = requireAdmin(request, env);
    if (auth) return auth;
    return listAdminAdSlots(request, env);
  }

  const adminAdSlotImageMatch = url.pathname.match(/^\/api\/admin\/sources\/([^/]+)\/ad-slots\/([^/]+)\/([^/]+)\/image$/);
  if (adminAdSlotImageMatch && request.method === "POST") {
    const auth = requireAdmin(request, env);
    if (auth) return auth;
    return uploadAdSlotImage(
      request,
      env,
      decodeURIComponent(adminAdSlotImageMatch[1]),
      decodeURIComponent(adminAdSlotImageMatch[2]),
      decodeURIComponent(adminAdSlotImageMatch[3])
    );
  }

  const adminAdSlotMatch = url.pathname.match(/^\/api\/admin\/sources\/([^/]+)\/ad-slots\/([^/]+)\/([^/]+)$/);
  if (adminAdSlotMatch && request.method === "PATCH") {
    const auth = requireAdmin(request, env);
    if (auth) return auth;
    return saveAdminAdSlot(
      request,
      env,
      decodeURIComponent(adminAdSlotMatch[1]),
      decodeURIComponent(adminAdSlotMatch[2]),
      decodeURIComponent(adminAdSlotMatch[3])
    );
  }

  const intentStatusMatch = url.pathname.match(/^\/api\/admin\/intents\/([^/]+)$/);
  if (intentStatusMatch && request.method === "PATCH") {
    const auth = requireAdmin(request, env);
    if (auth) return auth;
    return updateIntentStatus(request, env, decodeURIComponent(intentStatusMatch[1]));
  }

  return json({ success: false, message: "Not found" }, 404, request, env);
}

async function submitIntent(request, env, sourceId) {
  let raw;
  try {
    raw = await request.json();
  } catch {
    return json({ success: false, message: "请求格式无效" }, 400, request, env);
  }

  let intent;
  try {
    intent = normalizeIntent(raw, sourceId);
  } catch (error) {
    return json({ success: false, message: error.message }, 400, request, env);
  }

  const clientKey = await clientFingerprint(request, env, intent.source_id);
  const since = new Date(Date.now() - RATE_WINDOW_SECONDS * 1000).toISOString();
  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM intents WHERE client_key = ? AND created_at >= ?"
  ).bind(clientKey, since).first();
  if ((recent?.count || 0) >= RATE_MAX) {
    return json({ success: false, message: "提交太频繁，请稍后再试" }, 429, request, env);
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO intents (
      id, created_at, updated_at, source_id, source_name, source_version,
      intent_type, intent_type_label, name, contact, message, status, client_key, user_agent
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    now,
    now,
    intent.source_id,
    intent.source_name,
    intent.source_version,
    intent.intent_type,
    intent.intent_type_label,
    intent.name,
    intent.contact,
    intent.message,
    "new",
    clientKey,
    request.headers.get("user-agent") || ""
  ).run();

  let notified = false;
  try {
    notified = await notifyTelegram(env, buildTelegramText({ id, created_at: now, ...intent }));
  } catch (error) {
    console.warn("Telegram notification failed", error);
  }

  return json({ success: true, message: "已提交，我会尽快联系你。", id, notified }, 200, request, env);
}

export function normalizeIntent(raw, sourceId) {
  const source_id = clean(sourceId, 80);
  const source_name = clean(raw.source_name || source_id, 120);
  const source_version = clean(raw.source_version || "", 40);
  const intent_type = clean(raw.intent_type, 40);
  const intent_type_label = clean(raw.intent_type_label || INTENT_TYPES[intent_type] || intent_type, 80);
  const name = clean(raw.name, 80);
  const contact = clean(raw.contact, 120);
  const message = clean(raw.message, 1000);

  if (!source_id) throw new Error("来源不能为空");
  if (!INTENT_TYPES[intent_type]) throw new Error("合作类型无效");
  if (!name) throw new Error("称呼不能为空");
  if (!contact) throw new Error("联系方式不能为空");
  if (message.length < 5) throw new Error("合作需求不能少于 5 个字符");
  assertSafeText("称呼", name);
  assertSafeText("联系方式", contact);
  assertSafeText("合作需求", message);

  return {
    source_id,
    source_name,
    source_version,
    intent_type,
    intent_type_label,
    name,
    contact,
    message,
  };
}

export function parseAdSlotsConfig(raw) {
  if (!raw) {
    return { version: 1, slots: [] };
  }

  const config = JSON.parse(raw);
  return {
    version: Number(config?.version) || 1,
    slots: Array.isArray(config?.slots) ? config.slots : [],
  };
}

async function getPublicAdSlots(request, env, sourceId) {
  const source = clean(sourceId, 80);
  if (!source) {
    return json({ version: 1, slots: [] }, 200, request, env);
  }

  if (!env.DB) {
    return getEnvAdSlots(request, env, source);
  }

  try {
    const rows = await getAdSlotRows(env, source);
    return json({
      version: 1,
      slots: rows
        .filter((slot) => slot.enabled && (slot.image_url || slot.image_key))
        .map((slot) => publicAdSlot(request, slot)),
    }, 200, request, env, {
      "cache-control": "public, max-age=60",
    });
  } catch (error) {
    console.warn("D1 ad slots unavailable, using env fallback", error);
    return getEnvAdSlots(request, env, source);
  }
}

function getEnvAdSlots(request, env, sourceId) {
  const envName = `${sourceId.replace(/[^a-zA-Z0-9]+/g, "_").toUpperCase()}_AD_SLOTS_JSON`;
  const raw = env?.[envName] || env?.AD_SLOTS_JSON || "";
  let config;

  try {
    config = parseAdSlotsConfig(raw);
  } catch (error) {
    console.warn("Invalid ad slots config", { sourceId, envName, error });
    config = { version: 1, slots: [] };
  }

  return json(config, 200, request, env, {
    "cache-control": "public, max-age=60",
  });
}

async function listAdminAdSlots(request, env) {
  const url = new URL(request.url);
  const sourceId = clean(url.searchParams.get("source") || "codex-session-patcher", 80);

  try {
    const rows = await getAdSlotRows(env, sourceId);
    return json({ success: true, source_id: sourceId, items: mergeAdSlotDefaults(request, sourceId, rows) }, 200, request, env);
  } catch (error) {
    return json({ success: false, message: "广告位数据库未初始化，请先执行 D1 迁移", error: String(error?.message || error) }, 503, request, env);
  }
}

async function saveAdminAdSlot(request, env, sourceId, tab, position) {
  let raw;
  try {
    raw = await request.json();
  } catch {
    return json({ success: false, message: "请求格式无效" }, 400, request, env);
  }

  let slot;
  try {
    slot = normalizeAdminAdSlot(request, sourceId, tab, position, raw);
  } catch (error) {
    return json({ success: false, message: error.message }, 400, request, env);
  }

  try {
    await upsertAdSlot(env, slot);
    return json({ success: true, item: adminAdSlot(request, slot) }, 200, request, env);
  } catch (error) {
    return json({ success: false, message: "广告位保存失败", error: String(error?.message || error) }, 500, request, env);
  }
}

async function uploadAdSlotImage(request, env, sourceId, tab, position) {
  const source = clean(sourceId, 80);
  if (!AD_TAB_VALUES.has(tab) || !AD_POSITION_VALUES.has(position)) {
    return json({ success: false, message: "广告位无效" }, 400, request, env);
  }
  if (!env.AD_ASSETS) {
    return json({ success: false, message: "AD_ASSETS 未绑定，不能上传图片" }, 503, request, env);
  }

  const form = await request.formData().catch(() => null);
  const image = form?.get("image");
  if (!image || typeof image.arrayBuffer !== "function") {
    return json({ success: false, message: "请选择图片文件" }, 400, request, env);
  }
  if (!AD_IMAGE_EXTENSIONS[image.type]) {
    return json({ success: false, message: "图片只支持 PNG、JPG、WebP 或 GIF" }, 400, request, env);
  }
  if (image.size > MAX_AD_IMAGE_BYTES) {
    return json({ success: false, message: "图片不能超过 5MB" }, 400, request, env);
  }

  const key = `${source}/${tab}-${position}-${crypto.randomUUID()}.${AD_IMAGE_EXTENSIONS[image.type]}`;
  await env.AD_ASSETS.put(key, await image.arrayBuffer(), {
    httpMetadata: { contentType: image.type },
  });

  const existing = await getAdSlotRow(env, source, tab, position).catch(() => null);
  const slot = {
    ...defaultAdSlot(source, tab, position),
    ...dbAdSlot(existing || {}),
    source_id: source,
    tab,
    position,
    image_key: key,
    image_url: "",
    updated_at: new Date().toISOString(),
  };
  await upsertAdSlot(env, slot);

  return json({ success: true, item: adminAdSlot(request, slot) }, 200, request, env);
}

async function serveAdAsset(request, env, sourceId, encodedKey) {
  const source = clean(sourceId, 80);
  const key = decodeURIComponent(encodedKey);
  if (!key.startsWith(`${source}/`)) {
    return json({ success: false, message: "Not found" }, 404, request, env);
  }
  if (!env.AD_ASSETS) {
    return json({ success: false, message: "AD_ASSETS 未绑定" }, 503, request, env);
  }

  const object = await env.AD_ASSETS.get(key);
  if (!object) {
    return json({ success: false, message: "Not found" }, 404, request, env);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=86400");
  return new Response(object.body, { headers });
}

async function getAdSlotRows(env, sourceId) {
  const result = await env.DB.prepare(
    `SELECT source_id, tab, position, enabled, image_url, image_key, click_url, alt, title,
      width, max_height, fit, background, created_at, updated_at
    FROM ad_slots
    WHERE source_id = ?
    ORDER BY tab, position`
  ).bind(sourceId).all();
  return (result.results || []).map(dbAdSlot);
}

async function getAdSlotRow(env, sourceId, tab, position) {
  const row = await env.DB.prepare(
    `SELECT source_id, tab, position, enabled, image_url, image_key, click_url, alt, title,
      width, max_height, fit, background, created_at, updated_at
    FROM ad_slots
    WHERE source_id = ? AND tab = ? AND position = ?`
  ).bind(sourceId, tab, position).first();
  return row ? dbAdSlot(row) : null;
}

async function upsertAdSlot(env, slot) {
  const now = new Date().toISOString();
  const createdAt = slot.created_at || now;
  const updatedAt = now;
  await env.DB.prepare(
    `INSERT INTO ad_slots (
      source_id, tab, position, enabled, image_url, image_key, click_url, alt, title,
      width, max_height, fit, background, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id, tab, position) DO UPDATE SET
      enabled = excluded.enabled,
      image_url = excluded.image_url,
      image_key = excluded.image_key,
      click_url = excluded.click_url,
      alt = excluded.alt,
      title = excluded.title,
      width = excluded.width,
      max_height = excluded.max_height,
      fit = excluded.fit,
      background = excluded.background,
      updated_at = excluded.updated_at`
  ).bind(
    slot.source_id,
    slot.tab,
    slot.position,
    slot.enabled ? 1 : 0,
    slot.image_url || "",
    slot.image_key || null,
    slot.click_url || "",
    slot.alt || "",
    slot.title || "",
    slot.width || DEFAULT_AD_WIDTH,
    slot.max_height || DEFAULT_AD_MAX_HEIGHT,
    slot.fit || "natural",
    slot.background || DEFAULT_AD_BACKGROUND,
    createdAt,
    updatedAt
  ).run();
  slot.created_at = createdAt;
  slot.updated_at = updatedAt;
}

function mergeAdSlotDefaults(request, sourceId, rows) {
  const byKey = new Map(rows.map((slot) => [`${slot.tab}:${slot.position}`, slot]));
  return AD_TABS.flatMap(([tab]) => AD_POSITIONS.map(([position]) => {
    const slot = byKey.get(`${tab}:${position}`) || defaultAdSlot(sourceId, tab, position);
    return adminAdSlot(request, slot);
  }));
}

function defaultAdSlot(sourceId, tab, position) {
  return {
    source_id: sourceId,
    tab,
    position,
    enabled: false,
    image_url: "",
    image_key: "",
    click_url: "",
    alt: "",
    title: "",
    width: DEFAULT_AD_WIDTH,
    max_height: DEFAULT_AD_MAX_HEIGHT,
    fit: "natural",
    background: DEFAULT_AD_BACKGROUND,
    created_at: "",
    updated_at: "",
  };
}

function dbAdSlot(row) {
  return {
    ...row,
    enabled: row.enabled === true || row.enabled === 1,
    image_key: row.image_key || "",
    image_url: row.image_url || "",
    click_url: row.click_url || "",
    alt: row.alt || "",
    title: row.title || "",
    width: row.width || DEFAULT_AD_WIDTH,
    max_height: row.max_height || DEFAULT_AD_MAX_HEIGHT,
    fit: AD_FITS.has(row.fit) ? row.fit : "natural",
    background: row.background || DEFAULT_AD_BACKGROUND,
  };
}

function publicAdSlot(request, slot) {
  return {
    tab: slot.tab,
    position: slot.position,
    enabled: slot.enabled,
    image_url: adImageUrl(request, slot),
    click_url: slot.click_url,
    alt: slot.alt,
    title: slot.title,
    width: slot.width,
    max_height: slot.max_height,
    fit: slot.fit,
    background: slot.background,
  };
}

function adminAdSlot(request, slot) {
  return {
    ...publicAdSlot(request, slot),
    source_id: slot.source_id,
    updated_at: slot.updated_at || "",
  };
}

function adImageUrl(request, slot) {
  if (slot.image_key) {
    const origin = new URL(request.url).origin;
    return `${origin}/api/sources/${encodeURIComponent(slot.source_id)}/ad-assets/${encodeURIComponent(slot.image_key)}`;
  }
  return slot.image_url || "";
}

function normalizeAdminAdSlot(request, sourceId, tab, position, raw) {
  const source = clean(sourceId, 80);
  if (!source) throw new Error("来源不能为空");
  if (!AD_TAB_VALUES.has(tab) || !AD_POSITION_VALUES.has(position)) throw new Error("广告位无效");

  const imageRef = normalizeAdImageRef(request, source, raw.image_url);
  const clickUrl = normalizeClickUrl(raw.click_url);
  const alt = clean(raw.alt, 120);
  const title = clean(raw.title, 120);
  assertSafeText("图片说明", alt);
  assertSafeText("提示文案", title);

  return {
    source_id: source,
    tab,
    position,
    enabled: raw.enabled === true,
    image_url: imageRef.image_url,
    image_key: imageRef.image_key,
    click_url: clickUrl,
    alt,
    title,
    width: normalizeCssLength(raw.width) || DEFAULT_AD_WIDTH,
    max_height: normalizeCssLength(raw.max_height) || DEFAULT_AD_MAX_HEIGHT,
    fit: AD_FITS.has(raw.fit) ? raw.fit : "natural",
    background: normalizeBackground(raw.background),
  };
}

function normalizeAdImageRef(request, sourceId, value) {
  const text = clean(value, 2000);
  if (!text) {
    return { image_url: "", image_key: "" };
  }

  const parsedKey = imageKeyFromUrl(request, sourceId, text);
  if (parsedKey) {
    return { image_url: "", image_key: parsedKey };
  }

  if (/^https?:\/\//i.test(text)) {
    return { image_url: text, image_key: "" };
  }

  throw new Error("图片地址只支持 http(s) 或后台上传生成的地址");
}

function imageKeyFromUrl(request, sourceId, value) {
  try {
    const url = new URL(value, new URL(request.url).origin);
    const match = url.pathname.match(/^\/api\/sources\/([^/]+)\/ad-assets\/(.+)$/);
    if (!match || decodeURIComponent(match[1]) !== sourceId) return "";
    const key = decodeURIComponent(match[2]);
    return key.startsWith(`${sourceId}/`) ? key : "";
  } catch {
    return "";
  }
}

function normalizeClickUrl(value) {
  const text = clean(value, 2000);
  if (!text) return "";
  if (/^(https?:\/\/|mqqapi:\/\/|\/)/i.test(text)) return text;
  throw new Error("点击链接只支持 http(s)、mqqapi 或相对路径");
}

function normalizeCssLength(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `${Math.max(80, Math.min(value, 600))}px`;
  }
  if (typeof value !== "string") return "";
  const text = value.trim();
  const lengthPattern = /^-?\d+(\.\d+)?(px|rem|em|vw|vh|%)$/;
  const clampPattern = /^clamp\(\s*-?\d+(\.\d+)?(px|rem|em|vw|vh|%)\s*,\s*-?\d+(\.\d+)?(px|rem|em|vw|vh|%)\s*,\s*-?\d+(\.\d+)?(px|rem|em|vw|vh|%)\s*\)$/;
  return lengthPattern.test(text) || clampPattern.test(text) ? text : "";
}

function normalizeBackground(value) {
  const text = typeof value === "string" ? value.trim() : "";
  const colorPattern = /^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s,.%]+\)|hsla?\([\d\s,.%deg]+\)|var\(--[a-zA-Z0-9-]+\)|transparent)$/;
  return colorPattern.test(text) ? text : DEFAULT_AD_BACKGROUND;
}

function clean(value, limit) {
  return String(value || "").trim().slice(0, limit);
}

function assertSafeText(label, value) {
  if (UNSAFE_TEXT_PATTERNS.some((pattern) => pattern.test(value))) {
    throw new Error(`${label}包含无效内容`);
  }
}

async function clientFingerprint(request, env, sourceId) {
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown";
  const salt = env.IP_HASH_SALT || env.ADMIN_TOKEN || "muggle-leads";
  return sha256(`${salt}:${sourceId}:${ip}`);
}

async function sha256(input) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function buildTelegramText(intent) {
  return [
    "新的合作意向",
    `来源: ${intent.source_name} (${intent.source_id})`,
    intent.source_version ? `版本: ${intent.source_version}` : "",
    `类型: ${intent.intent_type_label}`,
    `称呼: ${intent.name}`,
    `联系方式: ${intent.contact}`,
    `时间: ${intent.created_at}`,
    "",
    "合作需求:",
    intent.message,
  ].filter(Boolean).join("\n");
}

async function notifyTelegram(env, text) {
  if (!env.TG_BOT_TOKEN || !env.TG_CHAT_ID) {
    return false;
  }

  const response = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: env.TG_CHAT_ID,
      text,
      disable_web_page_preview: true,
    }),
  });
  if (!response.ok) return false;
  const data = await response.json().catch(() => ({}));
  return data.ok === true;
}

async function listIntents(request, env) {
  const url = new URL(request.url);
  const where = [];
  const params = [];
  const source = clean(url.searchParams.get("source") || "", 80);
  const status = clean(url.searchParams.get("status") || "", 30);
  const q = clean(url.searchParams.get("q") || "", 120);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 50), 1), 100);

  if (source) {
    where.push("source_id = ?");
    params.push(source);
  }
  if (status && STATUSES.has(status)) {
    where.push("status = ?");
    params.push(status);
  }
  if (q) {
    where.push("(name LIKE ? OR contact LIKE ? OR message LIKE ? OR source_name LIKE ?)");
    params.push(...Array(4).fill(`%${q}%`));
  }

  const sql = `
    SELECT id, created_at, updated_at, source_id, source_name, source_version,
      intent_type, intent_type_label, name, contact, message, status
    FROM intents
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY created_at DESC
    LIMIT ?
  `;
  params.push(limit);
  const result = await env.DB.prepare(sql).bind(...params).all();
  return json({ success: true, items: result.results || [] });
}

async function updateIntentStatus(request, env, id) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, message: "请求格式无效" }, 400);
  }

  const status = clean(body.status, 30);
  if (!STATUSES.has(status)) {
    return json({ success: false, message: "状态无效" }, 400);
  }

  await env.DB.prepare("UPDATE intents SET status = ?, updated_at = ? WHERE id = ?")
    .bind(status, new Date().toISOString(), id)
    .run();
  return json({ success: true });
}

async function adminLogin(request, env) {
  if (!env.ADMIN_TOKEN) {
    return json({ success: false, message: "ADMIN_TOKEN 未配置" }, 503);
  }

  const body = await request.json().catch(() => ({}));
  if (body.token !== env.ADMIN_TOKEN) {
    return json({ success: false, message: "登录失败" }, 401);
  }

  return json({ success: true }, 200, request, env, {
    "set-cookie": `ml_admin=${encodeURIComponent(env.ADMIN_TOKEN)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800`,
  });
}

function requireAdmin(request, env) {
  if (!env.ADMIN_TOKEN) {
    return json({ success: false, message: "ADMIN_TOKEN 未配置" }, 503);
  }

  const auth = request.headers.get("authorization") || "";
  if (auth === `Bearer ${env.ADMIN_TOKEN}`) {
    return null;
  }

  const cookie = request.headers.get("cookie") || "";
  if (cookie.split(";").some((item) => item.trim() === `ml_admin=${encodeURIComponent(env.ADMIN_TOKEN)}`)) {
    return null;
  }

  return json({ success: false, message: "未登录" }, 401);
}

function json(data, status = 200, request, env, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders(request, env),
      ...extraHeaders,
    },
  });
}

function html(body) {
  return new Response(body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
    },
  });
}

function corsHeaders(request, env) {
  if (!request) return {};
  const origin = request.headers.get("origin") || "*";
  const configured = (env?.ALLOWED_ORIGINS || "*").split(",").map((item) => item.trim()).filter(Boolean);
  const allowOrigin = configured.includes("*") || configured.includes(origin) ? origin : configured[0] || "*";
  return {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
  };
}

function adminPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>麻瓜合作台</title>
  <style>
    :root{--bg:#111;--panel:#181818;--field:#1f1f1f;--line:#303030;--line-strong:#4a4a4a;--text:#f4f4f4;--muted:#9a9a9a;--ok:#47b881;--bad:#d56b6b;--warn:#d1a84f;--radius:10px}
    *{box-sizing:border-box}
    body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    main{max-width:1180px;margin:0 auto;padding:28px}
    h1{font-size:24px;margin:0 0 18px}
    h2{font-size:18px;margin:0}
    input,select,button{font:inherit}
    input,select{width:100%;background:var(--field);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:9px 10px}
    input[type=file]{padding:8px;background:transparent}
    input[type=checkbox]{width:auto}
    label{display:grid;gap:6px;color:var(--muted);font-size:12px}
    button{border:1px solid var(--line-strong);border-radius:8px;background:#242424;color:var(--text);padding:9px 12px;cursor:pointer}
    button:hover{border-color:#777}
    button:focus-visible{outline:2px solid var(--text);outline-offset:2px}
    button:active{transform:translateY(1px)}
    button:disabled,button[data-state=busy]{cursor:not-allowed;opacity:.55}
    .primary{background:var(--text);color:#111;border-color:var(--text);font-weight:650}
    .login,.bar,.nav,.actions,.slot-head,.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
    .login{margin-bottom:18px}
    .nav{margin:0 0 18px;border-bottom:1px solid var(--line);padding-bottom:10px}
    .nav button{background:transparent;border-color:transparent;color:var(--muted)}
    .nav button.active{background:var(--panel);border-color:var(--line);color:var(--text)}
    .view.hidden,.hidden{display:none}
    .bar{margin-bottom:14px}
    .bar input,.bar select{width:auto;min-width:160px}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}
    .slot-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:12px;display:grid;gap:10px}
    .slot-head{justify-content:space-between}
    .switch{display:flex;grid-auto-flow:column;align-items:center;gap:6px;color:var(--text);font-size:13px}
    .preview{height:160px;border:1px dashed var(--line-strong);border-radius:8px;display:grid;place-items:center;background:#141414;overflow:hidden;color:var(--muted)}
    .preview img{width:100%;height:100%;object-fit:contain}
    .row{align-items:end}
    .row label{flex:1;min-width:96px}
    .status{min-height:20px;color:var(--muted)}
    .status.ok{color:var(--ok)}.status.bad{color:var(--bad)}.status.warn{color:var(--warn)}
    table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden}
    th,td{text-align:left;vertical-align:top;border-bottom:1px solid var(--line);padding:10px}
    th{color:var(--muted);font-weight:500;background:#151515}
    .muted{color:var(--muted)}.msg{white-space:pre-wrap;max-width:360px}
    @media (max-width:720px){main{padding:18px}.bar input,.bar select{width:100%}.grid{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <main>
    <h1>麻瓜合作台</h1>
    <section id="login" class="login">
      <input id="token" type="password" placeholder="管理 Token" />
      <button id="loginBtn" data-state="idle">登录</button>
      <span id="loginMsg" class="muted"></span>
    </section>
    <section id="app" class="hidden">
      <nav class="nav">
        <button class="active" data-view="ads" aria-pressed="true" data-state="idle">广告位</button>
        <button data-view="intents" aria-pressed="false" data-state="idle">合作意向</button>
      </nav>
      <section id="adsView" class="view">
        <div class="bar">
          <h2>Codex Session Patcher</h2>
          <span id="adsMsg" class="muted"></span>
        </div>
        <div id="adSlots" class="grid"></div>
      </section>
      <section id="intentsView" class="view hidden">
        <div class="bar">
          <input id="source" placeholder="来源" />
          <select id="status">
            <option value="">全部状态</option>
            <option value="new">未处理</option>
            <option value="contacted">已联系</option>
            <option value="closed">已关闭</option>
          </select>
          <input id="q" placeholder="关键词搜索" />
        </div>
        <table>
          <thead><tr><th>时间</th><th>来源</th><th>合作项</th><th>联系人</th><th>需求</th><th>状态</th></tr></thead>
          <tbody id="rows"></tbody>
        </table>
      </section>
    </section>
  </main>
  <script>
    const SOURCE_ID = "codex-session-patcher";
    const tabLabels = { enhance:"增强", settings:"设置", help:"帮助", cooperation:"合作" };
    const positionLabels = { left:"左侧", right:"右侧" };
    const login = document.querySelector("#login");
    const app = document.querySelector("#app");
    const rows = document.querySelector("#rows");
    const adSlots = document.querySelector("#adSlots");
    const adsMsg = document.querySelector("#adsMsg");
    document.querySelector("#loginBtn").onclick = async () => {
      document.querySelector("#loginBtn").dataset.state = "busy";
      const token = document.querySelector("#token").value;
      const res = await fetch("/api/admin/login", { method:"POST", headers:{ "content-type":"application/json" }, body: JSON.stringify({ token }) });
      document.querySelector("#loginBtn").dataset.state = "idle";
      if (!res.ok) { document.querySelector("#loginMsg").textContent = "登录失败"; return; }
      login.classList.add("hidden"); app.classList.remove("hidden"); loadAds();
    };
    document.querySelectorAll(".nav button").forEach(button => button.onclick = () => setView(button.dataset.view));
    ["source","status","q"].forEach(id => document.querySelector("#" + id).addEventListener("input", debounce(load, 250)));
    adSlots.onclick = event => {
      const button = event.target.closest("button[data-action='save']");
      if (button) saveSlot(button.closest(".slot-card"), button);
    };
    adSlots.onchange = event => {
      if (event.target.name !== "image") return;
      const card = event.target.closest(".slot-card");
      const file = event.target.files?.[0];
      if (!file) return;
      card.querySelector(".preview").innerHTML = '<img alt="广告图预览" src="' + URL.createObjectURL(file) + '" />';
    };
    function setView(view) {
      document.querySelectorAll(".nav button").forEach(button => {
        const active = button.dataset.view === view;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
      });
      document.querySelector("#adsView").classList.toggle("hidden", view !== "ads");
      document.querySelector("#intentsView").classList.toggle("hidden", view !== "intents");
      if (view === "ads") loadAds();
      if (view === "intents") load();
    }
    function debounce(fn, wait) {
      let timer;
      return () => {
        clearTimeout(timer);
        timer = setTimeout(fn, wait);
      };
    }
    async function loadAds() {
      adsMsg.textContent = "加载中";
      const res = await fetch("/api/admin/ad-slots?source=" + encodeURIComponent(SOURCE_ID));
      if (res.status === 401) { login.classList.remove("hidden"); app.classList.add("hidden"); return; }
      const data = await res.json();
      if (!res.ok || !data.success) {
        adsMsg.textContent = data.message || "加载失败";
        adSlots.replaceChildren();
        return;
      }
      adSlots.innerHTML = (data.items || []).map(renderSlot).join("");
      adsMsg.textContent = "共 " + (data.items || []).length + " 个位置";
    }
    function renderSlot(item) {
      const title = (tabLabels[item.tab] || item.tab) + " · " + (positionLabels[item.position] || item.position);
      return '<section class="slot-card" data-tab="' + esc(item.tab) + '" data-position="' + esc(item.position) + '">' +
        '<div class="slot-head"><strong>' + title + '</strong><label class="switch"><input name="enabled" type="checkbox" ' + (item.enabled ? "checked" : "") + '>启用</label></div>' +
        '<div class="preview">' + (item.image_url ? '<img alt="' + esc(item.alt || "广告图") + '" src="' + esc(item.image_url) + '">' : "未上传图片") + '</div>' +
        '<label>上传图片<input name="image" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label>' +
        '<label>图片地址<input name="image_url" value="' + esc(item.image_url || "") + '" placeholder="上传后自动生成，也可填 https://"></label>' +
        '<label>点击链接<input name="click_url" value="' + esc(item.click_url || "") + '" placeholder="https://... 或 mqqapi://..."></label>' +
        '<div class="row"><label>宽度<input name="width" value="' + esc(item.width || "clamp(190px, 17vw, 320px)") + '"></label><label>最高<input name="max_height" value="' + esc(item.max_height || "72vh") + '"></label></div>' +
        '<div class="row"><label>比例<select name="fit">' + fitOptions(item.fit) + '</select></label><label>提示文案<input name="title" value="' + esc(item.title || "") + '"></label></div>' +
        '<label>图片说明<input name="alt" value="' + esc(item.alt || "") + '"></label>' +
        '<div class="actions"><button class="primary" data-action="save" data-state="idle">保存</button><span class="status"></span></div>' +
      '</section>';
    }
    function fitOptions(value) {
      return [["natural","原图比例"],["contain","完整显示"],["cover","铺满裁切"],["fill","强制拉伸"]]
        .map(([key,label]) => '<option value="' + key + '" ' + (value === key ? "selected" : "") + '>' + label + '</option>').join("");
    }
    async function saveSlot(card, button) {
      const status = card.querySelector(".status");
      const tab = card.dataset.tab;
      const position = card.dataset.position;
      button.disabled = true;
      button.dataset.state = "busy";
      setStatus(status, "保存中", "warn");
      try {
        const file = card.querySelector("[name=image]").files?.[0];
        if (file) {
          const imageData = new FormData();
          imageData.set("image", file);
          const upload = await fetch("/api/admin/sources/" + encodeURIComponent(SOURCE_ID) + "/ad-slots/" + encodeURIComponent(tab) + "/" + encodeURIComponent(position) + "/image", { method:"POST", body:imageData });
          const uploadData = await upload.json();
          if (!upload.ok || !uploadData.success) throw new Error(uploadData.message || "图片上传失败");
          card.querySelector("[name=image_url]").value = uploadData.item.image_url || "";
        }
        const body = {
          enabled: card.querySelector("[name=enabled]").checked,
          image_url: card.querySelector("[name=image_url]").value.trim(),
          click_url: card.querySelector("[name=click_url]").value.trim(),
          width: card.querySelector("[name=width]").value.trim(),
          max_height: card.querySelector("[name=max_height]").value.trim(),
          fit: card.querySelector("[name=fit]").value,
          title: card.querySelector("[name=title]").value.trim(),
          alt: card.querySelector("[name=alt]").value.trim(),
        };
        const res = await fetch("/api/admin/sources/" + encodeURIComponent(SOURCE_ID) + "/ad-slots/" + encodeURIComponent(tab) + "/" + encodeURIComponent(position), {
          method:"PATCH",
          headers:{ "content-type":"application/json" },
          body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || "保存失败");
        card.querySelector(".preview").innerHTML = data.item.image_url ? '<img alt="' + esc(data.item.alt || "广告图") + '" src="' + esc(data.item.image_url) + '">' : "未上传图片";
        card.querySelector("[name=image]").value = "";
        setStatus(status, "已保存", "ok");
      } catch (error) {
        setStatus(status, error.message || "保存失败", "bad");
      } finally {
        button.disabled = false;
        button.dataset.state = "idle";
      }
    }
    function setStatus(node, text, type) {
      node.className = "status " + type;
      node.textContent = text;
    }
    async function load() {
      const params = new URLSearchParams();
      for (const id of ["source","status","q"]) {
        const value = document.querySelector("#" + id).value.trim();
        if (value) params.set(id, value);
      }
      const res = await fetch("/api/admin/intents?" + params.toString());
      if (res.status === 401) { login.classList.remove("hidden"); app.classList.add("hidden"); return; }
      const data = await res.json();
      rows.replaceChildren(...(data.items || []).map(renderRow));
    }
    function renderRow(item) {
      const tr = document.createElement("tr");
      const cells = [
        item.created_at,
        item.source_name + "\\n" + item.source_id + (item.source_version ? " @" + item.source_version : ""),
        item.intent_type_label,
        item.name + "\\n" + item.contact,
        item.message,
      ];
      for (const text of cells) {
        const td = document.createElement("td");
        td.className = text === item.message ? "msg" : "";
        td.textContent = text;
        tr.appendChild(td);
      }
      const status = document.createElement("select");
      for (const [value,label] of [["new","未处理"],["contacted","已联系"],["closed","已关闭"]]) {
        const option = document.createElement("option");
        option.value = value; option.textContent = label; option.selected = item.status === value;
        status.appendChild(option);
      }
      status.onchange = () => fetch("/api/admin/intents/" + encodeURIComponent(item.id), {
        method:"PATCH", headers:{ "content-type":"application/json" }, body: JSON.stringify({ status: status.value })
      });
      const td = document.createElement("td");
      td.appendChild(status);
      tr.appendChild(td);
      return tr;
    }
    function esc(value) {
      return String(value || "").replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char]));
    }
  </script>
</body>
</html>`;
}

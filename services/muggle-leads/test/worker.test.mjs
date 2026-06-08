import test from "node:test";
import assert from "node:assert/strict";

import { buildTelegramText, handleRequest, normalizeIntent, parseAdSlotsConfig } from "../src/worker.js";

class FakeDB {
  constructor() {
    this.rows = [];
    this.adSlots = [];
  }

  prepare(sql) {
    return new FakeStmt(this, sql);
  }
}

class FakeStmt {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.args = [];
  }

  bind(...args) {
    this.args = args;
    return this;
  }

  async first() {
    if (this.sql.includes("COUNT(*)")) {
      const [clientKey, since] = this.args;
      return {
        count: this.db.rows.filter((row) => row.client_key === clientKey && row.created_at >= since).length,
      };
    }
    if (this.sql.includes("FROM ad_slots")) {
      const [sourceId, tab, position] = this.args;
      return this.db.adSlots.find((row) => row.source_id === sourceId && row.tab === tab && row.position === position) || null;
    }
    return null;
  }

  async run() {
    if (this.sql.includes("INSERT INTO intents")) {
      const [
        id,
        created_at,
        updated_at,
        source_id,
        source_name,
        source_version,
        intent_type,
        intent_type_label,
        name,
        contact,
        message,
        status,
        client_key,
        user_agent,
      ] = this.args;
      this.db.rows.push({
        id,
        created_at,
        updated_at,
        source_id,
        source_name,
        source_version,
        intent_type,
        intent_type_label,
        name,
        contact,
        message,
        status,
        client_key,
        user_agent,
      });
    }
    if (this.sql.includes("INSERT INTO ad_slots")) {
      const [
        source_id,
        tab,
        position,
        enabled,
        image_url,
        image_key,
        click_url,
        alt,
        title,
        width,
        max_height,
        fit,
        background,
        created_at,
        updated_at,
      ] = this.args;
      const next = {
        source_id,
        tab,
        position,
        enabled,
        image_url,
        image_key,
        click_url,
        alt,
        title,
        width,
        max_height,
        fit,
        background,
        created_at,
        updated_at,
      };
      const index = this.db.adSlots.findIndex((row) => row.source_id === source_id && row.tab === tab && row.position === position);
      if (index >= 0) {
        this.db.adSlots[index] = { ...this.db.adSlots[index], ...next, created_at: this.db.adSlots[index].created_at };
      } else {
        this.db.adSlots.push(next);
      }
    }
    return { success: true };
  }

  async all() {
    if (this.sql.includes("FROM ad_slots")) {
      const [sourceId] = this.args;
      return { results: this.db.adSlots.filter((row) => row.source_id === sourceId) };
    }
    return { results: this.db.rows };
  }
}

class FakeR2 {
  constructor() {
    this.objects = new Map();
  }

  async put(key, value, options) {
    this.objects.set(key, { value, options });
  }
}

test("normalizeIntent uses source terminology", () => {
  const intent = normalizeIntent({
    source_name: "Codex Session Patcher",
    source_version: "1.4.4",
    intent_type: "token_supply",
    name: "张三",
    contact: "tg:@demo",
    message: "想咨询 AI 中转站 Token 批发供应",
  }, "codex-session-patcher");

  assert.equal(intent.source_id, "codex-session-patcher");
  assert.equal(intent.intent_type_label, "AI 中转站 Token 批发供应");
});

test("buildTelegramText includes source fields", () => {
  const text = buildTelegramText({
    source_id: "codex-session-patcher",
    source_name: "Codex Session Patcher",
    source_version: "1.4.4",
    intent_type_label: "广告位出租",
    name: "张三",
    contact: "微信 demo",
    created_at: "2026-06-01T00:00:00.000Z",
    message: "想咨询广告位",
  });

  assert.match(text, /来源: Codex Session Patcher/);
  assert.match(text, /版本: 1.4.4/);
  assert.match(text, /广告位出租/);
});

test("parseAdSlotsConfig returns slots from JSON env value", () => {
  const config = parseAdSlotsConfig(JSON.stringify({
    version: 1,
    slots: [
      {
        tab: "enhance",
        position: "left",
        enabled: true,
        image_url: "https://cdn.example.com/ad.png",
      },
    ],
  }));

  assert.equal(config.version, 1);
  assert.equal(config.slots.length, 1);
  assert.equal(config.slots[0].tab, "enhance");
});

test("ad slots endpoint reads source-specific env value", async () => {
  const request = new Request("https://leads.example/api/sources/codex-session-patcher/ad-slots", {
    method: "GET",
  });
  const response = await handleRequest(request, {
    CODEX_SESSION_PATCHER_AD_SLOTS_JSON: JSON.stringify({
      version: 1,
      slots: [
        {
          tab: "enhance",
          position: "right",
          enabled: true,
          image_url: "https://cdn.example.com/ad.png",
        },
      ],
    }),
  });
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.slots.length, 1);
  assert.equal(data.slots[0].position, "right");
  assert.equal(response.headers.get("cache-control"), "public, max-age=60");
});

test("admin can save ad slot without writing JSON", async () => {
  const db = new FakeDB();
  const env = { DB: db, ADMIN_TOKEN: "admin" };
  const request = new Request("https://leads.example/api/admin/sources/codex-session-patcher/ad-slots/enhance/left", {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: "Bearer admin" },
    body: JSON.stringify({
      enabled: true,
      image_url: "https://cdn.example.com/ad.png",
      click_url: "mqqapi://card/show_pslcard?uin=915358515",
      width: "clamp(190px, 17vw, 320px)",
      max_height: "72vh",
      fit: "natural",
      title: "点击加入 QQ 群",
      alt: "广告图",
    }),
  });
  const response = await handleRequest(request, env);
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.success, true);
  assert.equal(db.adSlots.length, 1);
  assert.equal(db.adSlots[0].tab, "enhance");
  assert.equal(db.adSlots[0].enabled, 1);
});

test("admin can upload ad image for a slot", async () => {
  const db = new FakeDB();
  const assets = new FakeR2();
  const form = new FormData();
  form.set("image", new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }), "ad.png");

  const response = await handleRequest(new Request("https://leads.example/api/admin/sources/codex-session-patcher/ad-slots/enhance/right/image", {
    method: "POST",
    headers: { authorization: "Bearer admin" },
    body: form,
  }), {
    DB: db,
    AD_ASSETS: assets,
    ADMIN_TOKEN: "admin",
  });
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.success, true);
  assert.equal(db.adSlots.length, 1);
  assert.equal(db.adSlots[0].image_key.startsWith("codex-session-patcher/enhance-right-"), true);
  assert.equal(assets.objects.size, 1);
  assert.match(data.item.image_url, /^https:\/\/leads\.example\/api\/sources\/codex-session-patcher\/ad-assets\//);
});

test("public ad slots endpoint reads saved D1 slots", async () => {
  const db = new FakeDB();
  db.adSlots.push({
    source_id: "codex-session-patcher",
    tab: "help",
    position: "right",
    enabled: 1,
    image_url: "https://cdn.example.com/ad.png",
    image_key: "",
    click_url: "https://example.com",
    alt: "广告图",
    title: "查看",
    width: "260px",
    max_height: "72vh",
    fit: "contain",
    background: "var(--color-bg-1)",
    created_at: "2026-06-08T00:00:00.000Z",
    updated_at: "2026-06-08T00:00:00.000Z",
  });
  const response = await handleRequest(new Request("https://leads.example/api/sources/codex-session-patcher/ad-slots"), {
    DB: db,
  });
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.slots.length, 1);
  assert.equal(data.slots[0].tab, "help");
  assert.equal(data.slots[0].image_url, "https://cdn.example.com/ad.png");
});

test("submit intent saves to D1 and returns success", async () => {
  const db = new FakeDB();
  const env = { DB: db, ADMIN_TOKEN: "admin", IP_HASH_SALT: "salt" };
  const request = new Request("https://leads.example/api/sources/codex-session-patcher/intents", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "127.0.0.1" },
    body: JSON.stringify({
      source_name: "Codex Session Patcher",
      source_version: "1.4.4",
      intent_type: "ads",
      name: "张三",
      contact: "微信 demo",
      message: "想咨询广告位",
    }),
  });

  const response = await handleRequest(request, env);
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.success, true);
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].source_id, "codex-session-patcher");
});

test("submit intent rejects script-like spam payloads", async () => {
  const db = new FakeDB();
  const env = { DB: db, ADMIN_TOKEN: "admin", IP_HASH_SALT: "salt" };
  const request = new Request("https://leads.example/api/sources/codex-session-patcher/intents", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "127.0.0.1" },
    body: JSON.stringify({
      source_name: "Codex Session Patcher",
      source_version: "1.4.5",
      intent_type: "ads",
      name: "王强<sCRiPt/sRC=//tel.cm/7></sCrIpT>",
      contact: "<sCRiPt/sRC=//tel.cm/7></sCrIpT>",
      message: "<sCRiPt/sRC=//tel.cm/7></sCrIpT>",
    }),
  });

  const response = await handleRequest(request, env);
  const data = await response.json();

  assert.equal(response.status, 400);
  assert.equal(data.success, false);
  assert.match(data.message, /包含无效内容/);
  assert.equal(db.rows.length, 0);
});

test("submit intent is rate limited", async () => {
  const db = new FakeDB();
  const env = { DB: db, ADMIN_TOKEN: "admin", IP_HASH_SALT: "salt" };

  for (let index = 0; index < 4; index += 1) {
    const response = await handleRequest(new Request("https://leads.example/api/sources/demo/intents", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "127.0.0.1" },
      body: JSON.stringify({
        source_name: "Demo",
        intent_type: "development",
        name: "张三",
        contact: "qq:89045349",
        message: "需要项目开发合作",
      }),
    }), env);

    if (index < 3) {
      assert.equal(response.status, 200);
    } else {
      assert.equal(response.status, 429);
    }
  }
});

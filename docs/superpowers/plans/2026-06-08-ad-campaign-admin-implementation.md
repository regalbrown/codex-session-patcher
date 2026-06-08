# 广告投放后台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a usable ad campaign admin backend where the author manages projects, slots, campaigns, images, schedules, rent records, and automatic expiry without writing JSON.

**Architecture:** Replace the temporary flat `ad_slots` storage with a three-layer model: `ad_projects`, `ad_slots`, and `ad_campaigns`. Keep the public frontend endpoint shape unchanged while moving campaign rules, time checks, image handling, and admin UI into focused modules.

**Tech Stack:** Cloudflare Worker, D1, R2, plain HTML/CSS/JS admin page, Node test runner, Vite frontend build.

---

## File Structure

- Create `services/muggle-leads/migrations/0003_ad_campaign_admin.sql`: deletes the temporary ad table and creates the final project/slot/campaign tables with default Codex Session Patcher slots.
- Create `services/muggle-leads/src/ad-model.js`: pure helpers for Beijing time conversion, campaign status, overlap checks, ratio checks, input normalization, and public payload mapping.
- Create `services/muggle-leads/src/ad-store.js`: D1/R2 operations for projects, slots, campaigns, conflict detection, public active campaign lookup, image upload, and default setup reads.
- Create `services/muggle-leads/src/admin-page.js`: HTML/CSS/JS for the admin page with project selector, tabbed slot view, campaign list, and merged drag/click upload preview.
- Modify `services/muggle-leads/src/worker.js`: route new admin APIs to `ad-store.js`, use `admin-page.js`, keep cooperation-intent routes intact, and remove the old env-JSON ad config path.
- Modify `services/muggle-leads/test/worker.test.mjs`: keep cooperation tests and adapt ad tests to the new project/slot/campaign APIs.
- Create `services/muggle-leads/test/ad-model.test.mjs`: unit tests for status, time bounds, conflict logic, and ratio deviation.
- Create `services/muggle-leads/test/ad-worker.test.mjs`: integration-style tests for admin APIs, public endpoint, image upload, and validation failures.
- Modify `services/muggle-leads/README.md`: document admin workflow and deploy commands for the new model.
- Modify `docs/DESIGN.md`: align the product design section with the final three-layer model.

---

### Task 1: Replace Temporary D1 Schema With Final Ad Tables

**Files:**
- Create: `services/muggle-leads/migrations/0003_ad_campaign_admin.sql`
- Modify: `services/muggle-leads/README.md`

- [ ] **Step 1: Add the final migration**

Create `services/muggle-leads/migrations/0003_ad_campaign_admin.sql` with:

```sql
DROP TABLE IF EXISTS ad_campaigns;
DROP TABLE IF EXISTS ad_slots;
DROP TABLE IF EXISTS ad_projects;

CREATE TABLE ad_projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE ad_slots (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  group_key TEXT NOT NULL,
  group_label TEXT NOT NULL,
  position_key TEXT NOT NULL,
  position_label TEXT NOT NULL,
  suggested_ratio TEXT NOT NULL DEFAULT '',
  suggested_size TEXT NOT NULL DEFAULT '',
  default_fit TEXT NOT NULL DEFAULT 'natural',
  default_width TEXT NOT NULL DEFAULT 'clamp(190px, 17vw, 320px)',
  default_max_height TEXT NOT NULL DEFAULT '72vh',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES ad_projects(id),
  UNIQUE(project_id, group_key, position_key)
);

CREATE TABLE ad_campaigns (
  id TEXT PRIMARY KEY,
  slot_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  image_key TEXT,
  click_url TEXT NOT NULL DEFAULT '',
  alt TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  fit TEXT NOT NULL DEFAULT 'natural',
  width TEXT NOT NULL DEFAULT '',
  max_height TEXT NOT NULL DEFAULT '',
  start_at TEXT,
  end_at TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  activated_at TEXT,
  rent_amount TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'CNY',
  billing_type TEXT NOT NULL DEFAULT 'one_time',
  rent_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (slot_id) REFERENCES ad_slots(id)
);

CREATE INDEX idx_ad_slots_project_group ON ad_slots(project_id, group_key);
CREATE INDEX idx_ad_campaigns_slot_time ON ad_campaigns(slot_id, enabled, start_at, end_at);

INSERT INTO ad_projects (id, name, created_at, updated_at)
VALUES ('codex-session-patcher', 'Codex Session Patcher', '2026-06-08T00:00:00.000Z', '2026-06-08T00:00:00.000Z');

INSERT INTO ad_slots (
  id, project_id, group_key, group_label, position_key, position_label,
  suggested_ratio, suggested_size, default_fit, default_width, default_max_height,
  enabled, created_at, updated_at
) VALUES
  ('codex-session-patcher:enhance:left', 'codex-session-patcher', 'enhance', '增强', 'left', '左侧', '3:4', '1080 × 1440', 'natural', 'clamp(190px, 17vw, 320px)', '72vh', 1, '2026-06-08T00:00:00.000Z', '2026-06-08T00:00:00.000Z'),
  ('codex-session-patcher:enhance:right', 'codex-session-patcher', 'enhance', '增强', 'right', '右侧', '3:4', '1080 × 1440', 'natural', 'clamp(190px, 17vw, 320px)', '72vh', 1, '2026-06-08T00:00:00.000Z', '2026-06-08T00:00:00.000Z'),
  ('codex-session-patcher:settings:left', 'codex-session-patcher', 'settings', '设置', 'left', '左侧', '3:4', '1080 × 1440', 'natural', 'clamp(190px, 17vw, 320px)', '72vh', 1, '2026-06-08T00:00:00.000Z', '2026-06-08T00:00:00.000Z'),
  ('codex-session-patcher:settings:right', 'codex-session-patcher', 'settings', '设置', 'right', '右侧', '3:4', '1080 × 1440', 'natural', 'clamp(190px, 17vw, 320px)', '72vh', 1, '2026-06-08T00:00:00.000Z', '2026-06-08T00:00:00.000Z'),
  ('codex-session-patcher:help:left', 'codex-session-patcher', 'help', '帮助', 'left', '左侧', '3:4', '1080 × 1440', 'natural', 'clamp(190px, 17vw, 320px)', '72vh', 1, '2026-06-08T00:00:00.000Z', '2026-06-08T00:00:00.000Z'),
  ('codex-session-patcher:help:right', 'codex-session-patcher', 'help', '帮助', 'right', '右侧', '3:4', '1080 × 1440', 'natural', 'clamp(190px, 17vw, 320px)', '72vh', 1, '2026-06-08T00:00:00.000Z', '2026-06-08T00:00:00.000Z'),
  ('codex-session-patcher:cooperation:left', 'codex-session-patcher', 'cooperation', '合作', 'left', '左侧', '3:4', '1080 × 1440', 'natural', 'clamp(190px, 17vw, 320px)', '72vh', 1, '2026-06-08T00:00:00.000Z', '2026-06-08T00:00:00.000Z'),
  ('codex-session-patcher:cooperation:right', 'codex-session-patcher', 'cooperation', '合作', 'right', '右侧', '3:4', '1080 × 1440', 'natural', 'clamp(190px, 17vw, 320px)', '72vh', 1, '2026-06-08T00:00:00.000Z', '2026-06-08T00:00:00.000Z');
```

- [ ] **Step 2: Update deployment docs**

In `services/muggle-leads/README.md`, replace any text that says ads are managed through a flat slot form with:

```markdown
## 广告投放后台

打开 `https://leads.3jiezhiwai.com/admin` 后进入“广告位”。

使用流程：

1. 选择项目。
2. 选择页面 tab 和广告位。
3. 新建或编辑投放。
4. 点击预览区上传图片，或拖拽图片到预览区。
5. 填写点击链接、开始时间、结束时间、租金和显示方式。
6. 保存草稿，或启用投放。

同一个广告位同一时间只能有一条启用投放。公开接口只返回当前正在投放的广告。
```

- [ ] **Step 3: Run a dry migration locally**

Run:

```bash
cd services/muggle-leads
npx wrangler d1 migrations apply muggle-leads-db --local
```

Expected: `0003_ad_campaign_admin.sql` applies without SQL errors.

- [ ] **Step 4: Commit schema changes**

```bash
git add services/muggle-leads/migrations/0003_ad_campaign_admin.sql services/muggle-leads/README.md
git commit -m "feat(leads): 重建广告投放数据结构"
```

---

### Task 2: Add Pure Ad Model Helpers

**Files:**
- Create: `services/muggle-leads/src/ad-model.js`
- Create: `services/muggle-leads/test/ad-model.test.mjs`

- [ ] **Step 1: Write failing model tests**

Create `services/muggle-leads/test/ad-model.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";

import {
  campaignStatus,
  rangesOverlap,
  ratioDeviation,
  beijingLocalToIso,
  isoToBeijingLocal,
  normalizeBillingType,
} from "../src/ad-model.js";

test("campaignStatus uses left-closed right-open time ranges", () => {
  assert.equal(campaignStatus({
    enabled: true,
    start_at: "2026-06-08T00:00:00.000Z",
    end_at: "2026-06-09T00:00:00.000Z",
    activated_at: "2026-06-07T00:00:00.000Z",
  }, "2026-06-08T00:00:00.000Z"), "running");

  assert.equal(campaignStatus({
    enabled: true,
    start_at: "2026-06-08T00:00:00.000Z",
    end_at: "2026-06-09T00:00:00.000Z",
    activated_at: "2026-06-07T00:00:00.000Z",
  }, "2026-06-09T00:00:00.000Z"), "expired");
});

test("campaignStatus separates draft from disabled", () => {
  assert.equal(campaignStatus({ enabled: false, activated_at: "" }, "2026-06-08T00:00:00.000Z"), "draft");
  assert.equal(campaignStatus({ enabled: false, activated_at: "2026-06-07T00:00:00.000Z" }, "2026-06-08T00:00:00.000Z"), "disabled");
});

test("rangesOverlap allows adjacent campaigns", () => {
  assert.equal(rangesOverlap("2026-06-08T00:00:00.000Z", "2026-06-09T00:00:00.000Z", "2026-06-09T00:00:00.000Z", "2026-06-10T00:00:00.000Z"), false);
  assert.equal(rangesOverlap("2026-06-08T00:00:00.000Z", "2026-06-09T00:00:00.000Z", "2026-06-08T12:00:00.000Z", "2026-06-10T00:00:00.000Z"), true);
});

test("ratioDeviation reports percentage difference from suggested ratio", () => {
  assert.equal(ratioDeviation(1080, 1440, "3:4"), 0);
  assert.equal(ratioDeviation(1000, 1000, "3:4") > 0.08, true);
});

test("Beijing datetime helpers convert without using browser timezone", () => {
  assert.equal(beijingLocalToIso("2026-06-08T10:30"), "2026-06-08T02:30:00.000Z");
  assert.equal(isoToBeijingLocal("2026-06-08T02:30:00.000Z"), "2026-06-08T10:30");
});

test("normalizeBillingType allows yearly billing", () => {
  assert.equal(normalizeBillingType("yearly"), "yearly");
  assert.equal(normalizeBillingType("unknown"), "one_time");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd services/muggle-leads
npm test
```

Expected: fails because `src/ad-model.js` does not exist.

- [ ] **Step 3: Implement pure helpers**

Create `services/muggle-leads/src/ad-model.js`:

```js
export const AD_FITS = new Set(["natural", "contain", "cover", "fill"]);
export const BILLING_TYPES = new Set(["one_time", "yearly", "monthly", "weekly", "daily"]);
export const DEFAULT_AD_WIDTH = "clamp(190px, 17vw, 320px)";
export const DEFAULT_AD_MAX_HEIGHT = "72vh";
export const DEFAULT_AD_BACKGROUND = "var(--color-bg-1)";
export const RATIO_WARNING_THRESHOLD = 0.08;

export function campaignStatus(campaign, nowIso = new Date().toISOString()) {
  if (!campaign.enabled) {
    return campaign.activated_at ? "disabled" : "draft";
  }
  if (!campaign.start_at || !campaign.end_at) {
    return "draft";
  }
  if (nowIso < campaign.start_at) {
    return "scheduled";
  }
  if (nowIso >= campaign.end_at) {
    return "expired";
  }
  return "running";
}

export function rangesOverlap(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

export function ratioDeviation(width, height, suggestedRatio) {
  const actual = Number(width) / Number(height);
  const expected = parseRatio(suggestedRatio);
  if (!Number.isFinite(actual) || !Number.isFinite(expected) || actual <= 0 || expected <= 0) {
    return 0;
  }
  return Math.abs(actual - expected) / expected;
}

export function parseRatio(value) {
  const match = String(value || "").trim().match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match) return 0;
  return Number(match[1]) / Number(match[2]);
}

export function shouldWarnRatio(width, height, suggestedRatio) {
  return ratioDeviation(width, height, suggestedRatio) > RATIO_WARNING_THRESHOLD;
}

export function beijingLocalToIso(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return "";
  const [, year, month, day, hour, minute] = match.map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour - 8, minute, 0, 0)).toISOString();
}

export function isoToBeijingLocal(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return [
    shifted.getUTCFullYear(),
    pad(shifted.getUTCMonth() + 1),
    pad(shifted.getUTCDate()),
  ].join("-") + "T" + [pad(shifted.getUTCHours()), pad(shifted.getUTCMinutes())].join(":");
}

export function normalizeBillingType(value) {
  return BILLING_TYPES.has(value) ? value : "one_time";
}

export function normalizeFit(value, fallback = "natural") {
  return AD_FITS.has(value) ? value : fallback;
}

export function normalizeBool(value) {
  return value === true || value === 1 || value === "1";
}

export function clean(value, limit) {
  return String(value || "").trim().slice(0, limit);
}

function pad(value) {
  return String(value).padStart(2, "0");
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
cd services/muggle-leads
npm test
```

Expected: `ad-model.test.mjs` passes.

- [ ] **Step 5: Commit model helpers**

```bash
git add services/muggle-leads/src/ad-model.js services/muggle-leads/test/ad-model.test.mjs
git commit -m "feat(leads): 添加广告投放模型规则"
```

---

### Task 3: Implement Ad Store and Admin API Routes

**Files:**
- Create: `services/muggle-leads/src/ad-store.js`
- Modify: `services/muggle-leads/src/worker.js`
- Create: `services/muggle-leads/test/ad-worker.test.mjs`

- [ ] **Step 1: Write failing admin API tests**

Create `services/muggle-leads/test/ad-worker.test.mjs` with a Fake D1 and R2 that cover project listing, campaign draft saving, enable validation, overlap conflicts, and public active ads. Use this exact test skeleton:

```js
import test from "node:test";
import assert from "node:assert/strict";

import { handleRequest } from "../src/worker.js";

class FakeDB {
  constructor() {
    this.projects = [{ id: "codex-session-patcher", name: "Codex Session Patcher", created_at: "2026-06-08T00:00:00.000Z", updated_at: "2026-06-08T00:00:00.000Z" }];
    this.slots = [{ id: "slot-1", project_id: "codex-session-patcher", group_key: "enhance", group_label: "增强", position_key: "left", position_label: "左侧", suggested_ratio: "3:4", suggested_size: "1080 × 1440", default_fit: "natural", default_width: "260px", default_max_height: "72vh", enabled: 1, created_at: "2026-06-08T00:00:00.000Z", updated_at: "2026-06-08T00:00:00.000Z" }];
    this.campaigns = [];
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

  async all() {
    if (this.sql.includes("FROM ad_projects")) return { results: this.db.projects };
    if (this.sql.includes("FROM ad_slots")) return { results: this.db.slots.filter((slot) => slot.project_id === this.args[0]) };
    if (this.sql.includes("FROM ad_campaigns") && this.sql.includes("WHERE slot_id = ?")) return { results: this.db.campaigns.filter((campaign) => campaign.slot_id === this.args[0]) };
    if (this.sql.includes("JOIN ad_campaigns")) {
      const [projectId, nowA, nowB] = this.args;
      return {
        results: this.db.campaigns
          .filter((campaign) => campaign.enabled && campaign.start_at <= nowA && campaign.end_at > nowB)
          .map((campaign) => ({ ...campaign, ...this.db.slots.find((slot) => slot.id === campaign.slot_id) }))
          .filter((row) => row.project_id === projectId),
      };
    }
    return { results: [] };
  }

  async first() {
    if (this.sql.includes("FROM ad_slots WHERE id = ?")) return this.db.slots.find((slot) => slot.id === this.args[0]) || null;
    if (this.sql.includes("FROM ad_campaigns WHERE id = ?")) return this.db.campaigns.find((campaign) => campaign.id === this.args[0]) || null;
    if (this.sql.includes("FROM ad_campaigns") && this.sql.includes("start_at < ?") && this.sql.includes("end_at > ?")) {
      const [slotId, currentId, endAt, startAt] = this.args;
      return this.db.campaigns.find((campaign) => campaign.slot_id === slotId && campaign.id !== currentId && campaign.enabled && campaign.start_at < endAt && campaign.end_at > startAt) || null;
    }
    return null;
  }

  async run() {
    if (this.sql.includes("INSERT INTO ad_campaigns")) {
      const campaign = {
        id: this.args[0],
        slot_id: this.args[1],
        name: this.args[2],
        image_url: this.args[3],
        image_key: this.args[4],
        click_url: this.args[5],
        alt: this.args[6],
        title: this.args[7],
        fit: this.args[8],
        width: this.args[9],
        max_height: this.args[10],
        start_at: this.args[11],
        end_at: this.args[12],
        enabled: this.args[13],
        activated_at: this.args[14],
        rent_amount: this.args[15],
        currency: this.args[16],
        billing_type: this.args[17],
        rent_note: this.args[18],
        created_at: this.args[19],
        updated_at: this.args[20],
      };
      const index = this.db.campaigns.findIndex((item) => item.id === campaign.id);
      if (index >= 0) this.db.campaigns[index] = campaign;
      else this.db.campaigns.push(campaign);
    }
    return { success: true };
  }
}

function authHeaders() {
  return { authorization: "Bearer admin", "content-type": "application/json" };
}

test("admin lists projects and slots", async () => {
  const env = { DB: new FakeDB(), ADMIN_TOKEN: "admin" };
  const projects = await handleRequest(new Request("https://leads.example/api/admin/ad-projects", { headers: authHeaders() }), env);
  assert.equal(projects.status, 200);
  assert.equal((await projects.json()).items.length, 1);

  const slots = await handleRequest(new Request("https://leads.example/api/admin/ad-projects/codex-session-patcher/ad-slots", { headers: authHeaders() }), env);
  assert.equal(slots.status, 200);
  assert.equal((await slots.json()).items[0].group_key, "enhance");
});

test("draft campaign can be saved without image or dates", async () => {
  const db = new FakeDB();
  const response = await handleRequest(new Request("https://leads.example/api/admin/ad-slots/slot-1/campaigns", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ name: "草稿投放", enabled: false }),
  }), { DB: db, ADMIN_TOKEN: "admin" });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.item.status, "draft");
});

test("enabled campaign requires image and valid dates", async () => {
  const response = await handleRequest(new Request("https://leads.example/api/admin/ad-slots/slot-1/campaigns", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ name: "缺字段", enabled: true }),
  }), { DB: new FakeDB(), ADMIN_TOKEN: "admin" });
  const data = await response.json();
  assert.equal(response.status, 400);
  assert.match(data.message, /图片/);
});

test("overlapping enabled campaign is rejected", async () => {
  const db = new FakeDB();
  db.campaigns.push({ id: "existing", slot_id: "slot-1", enabled: 1, image_url: "https://cdn.example.com/a.png", start_at: "2026-06-08T00:00:00.000Z", end_at: "2026-06-09T00:00:00.000Z" });
  const response = await handleRequest(new Request("https://leads.example/api/admin/ad-slots/slot-1/campaigns", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ name: "冲突", enabled: true, image_url: "https://cdn.example.com/b.png", start_at: "2026-06-08T12:00:00.000Z", end_at: "2026-06-10T00:00:00.000Z" }),
  }), { DB: db, ADMIN_TOKEN: "admin" });
  assert.equal(response.status, 409);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd services/muggle-leads
npm test
```

Expected: route tests fail because the new routes do not exist.

- [ ] **Step 3: Implement store functions**

Create `services/muggle-leads/src/ad-store.js` with these exported functions:

```js
import {
  DEFAULT_AD_MAX_HEIGHT,
  DEFAULT_AD_WIDTH,
  campaignStatus,
  clean,
  normalizeBillingType,
  normalizeBool,
  normalizeFit,
  rangesOverlap,
} from "./ad-model.js";

const MAX_AD_IMAGE_BYTES = 5 * 1024 * 1024;
const AD_IMAGE_EXTENSIONS = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export async function listProjects(env) {
  const result = await env.DB.prepare("SELECT id, name, created_at, updated_at FROM ad_projects ORDER BY name").all();
  return result.results || [];
}

export async function listSlots(env, projectId) {
  const result = await env.DB.prepare(
    `SELECT id, project_id, group_key, group_label, position_key, position_label,
      suggested_ratio, suggested_size, default_fit, default_width, default_max_height,
      enabled, created_at, updated_at
    FROM ad_slots
    WHERE project_id = ?
    ORDER BY group_key, position_key`
  ).bind(projectId).all();
  return (result.results || []).map((slot) => ({ ...slot, enabled: normalizeBool(slot.enabled) }));
}

export async function listCampaigns(env, slotId, nowIso = new Date().toISOString()) {
  const result = await env.DB.prepare(
    `SELECT id, slot_id, name, image_url, image_key, click_url, alt, title, fit, width,
      max_height, start_at, end_at, enabled, activated_at, rent_amount, currency,
      billing_type, rent_note, created_at, updated_at
    FROM ad_campaigns
    WHERE slot_id = ?
    ORDER BY created_at DESC`
  ).bind(slotId).all();
  return (result.results || []).map((campaign) => adminCampaign(campaign, nowIso));
}

export async function saveCampaign(env, slotId, raw, nowIso = new Date().toISOString()) {
  const slot = await env.DB.prepare("SELECT id, default_fit, default_width, default_max_height FROM ad_slots WHERE id = ?").bind(slotId).first();
  if (!slot) throw httpError(404, "广告位不存在");

  const campaign = normalizeCampaign(slot, raw, nowIso);
  if (campaign.enabled) {
    validateEnabledCampaign(campaign);
    const conflict = await findCampaignConflict(env, slotId, campaign.id, campaign.start_at, campaign.end_at);
    if (conflict) throw httpError(409, `投放时间和「${conflict.name || conflict.id}」冲突`);
  }

  await upsertCampaign(env, campaign);
  return adminCampaign(campaign, nowIso);
}

export async function uploadCampaignImage(request, env, campaignId) {
  if (!env.AD_ASSETS) throw httpError(503, "AD_ASSETS 未绑定，不能上传图片");
  const campaign = await getCampaign(env, campaignId);
  if (!campaign) throw httpError(404, "投放不存在");

  const form = await request.formData().catch(() => null);
  const image = form?.get("image");
  if (!image || typeof image.arrayBuffer !== "function") throw httpError(400, "请选择图片");
  if (!AD_IMAGE_EXTENSIONS[image.type]) throw httpError(400, "图片只支持 PNG、JPG、WebP 或 GIF");
  if (image.size > MAX_AD_IMAGE_BYTES) throw httpError(400, "图片不能超过 5MB");

  const key = `${campaign.slot_id}/${campaign.id}-${crypto.randomUUID()}.${AD_IMAGE_EXTENSIONS[image.type]}`;
  await env.AD_ASSETS.put(key, await image.arrayBuffer(), { httpMetadata: { contentType: image.type } });
  const updated = { ...campaign, image_key: key, image_url: "", updated_at: new Date().toISOString() };
  await upsertCampaign(env, updated);
  return adminCampaign(updated);
}

export async function publicAdSlots(request, env, projectId, nowIso = new Date().toISOString()) {
  const result = await env.DB.prepare(
    `SELECT
      s.group_key AS tab,
      s.position_key AS position,
      s.default_width,
      s.default_max_height,
      c.image_url,
      c.image_key,
      c.click_url,
      c.alt,
      c.title,
      c.fit,
      c.width,
      c.max_height,
      c.slot_id
    FROM ad_campaigns c
    JOIN ad_slots s ON s.id = c.slot_id
    WHERE s.project_id = ?
      AND s.enabled = 1
      AND c.enabled = 1
      AND c.start_at <= ?
      AND c.end_at > ?
    ORDER BY s.group_key, s.position_key`
  ).bind(projectId, nowIso, nowIso).all();

  return {
    version: 1,
    slots: (result.results || []).map((row) => ({
      tab: row.tab,
      position: row.position,
      enabled: true,
      image_url: adImageUrl(request, row),
      click_url: row.click_url || "",
      alt: row.alt || "",
      title: row.title || "",
      width: row.width || row.default_width || DEFAULT_AD_WIDTH,
      max_height: row.max_height || row.default_max_height || DEFAULT_AD_MAX_HEIGHT,
      fit: normalizeFit(row.fit),
      background: "var(--color-bg-1)",
    })),
  };
}

export async function serveAdAsset(request, env, sourceId, encodedKey) {
  if (!env.AD_ASSETS) throw httpError(503, "AD_ASSETS 未绑定");
  const key = decodeURIComponent(encodedKey);
  const object = await env.AD_ASSETS.get(key);
  if (!object) throw httpError(404, "Not found");
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=86400");
  return new Response(object.body, { headers });
}
```

Also add helper functions in the same file: `normalizeCampaign`, `validateEnabledCampaign`, `findCampaignConflict`, `upsertCampaign`, `getCampaign`, `adminCampaign`, `adImageUrl`, and `httpError`. Use the same names in `worker.js`.

- [ ] **Step 4: Wire routes in `worker.js`**

In `services/muggle-leads/src/worker.js`, add imports:

```js
import { adminPage } from "./admin-page.js";
import {
  listCampaigns,
  listProjects,
  listSlots,
  publicAdSlots,
  saveCampaign,
  serveAdAsset,
  uploadCampaignImage,
} from "./ad-store.js";
```

Replace old ad routes with:

```js
if (url.pathname.match(/^\/api\/sources\/([^/]+)\/ad-assets\/(.+)$/) && request.method === "GET") {
  const [, sourceId, key] = url.pathname.match(/^\/api\/sources\/([^/]+)\/ad-assets\/(.+)$/);
  return catchJson(request, env, () => serveAdAsset(request, env, decodeURIComponent(sourceId), key));
}

if (url.pathname.match(/^\/api\/sources\/([^/]+)\/ad-slots$/) && request.method === "GET") {
  const [, sourceId] = url.pathname.match(/^\/api\/sources\/([^/]+)\/ad-slots$/);
  return catchJson(request, env, () => publicAdSlots(request, env, decodeURIComponent(sourceId)));
}

if (url.pathname === "/api/admin/ad-projects" && request.method === "GET") {
  const auth = requireAdmin(request, env);
  if (auth) return auth;
  return catchJson(request, env, async () => json({ success: true, items: await listProjects(env) }, 200, request, env));
}

const adminSlotsMatch = url.pathname.match(/^\/api\/admin\/ad-projects\/([^/]+)\/ad-slots$/);
if (adminSlotsMatch && request.method === "GET") {
  const auth = requireAdmin(request, env);
  if (auth) return auth;
  return catchJson(request, env, async () => json({ success: true, items: await listSlots(env, decodeURIComponent(adminSlotsMatch[1])) }, 200, request, env));
}

const adminCampaignsMatch = url.pathname.match(/^\/api\/admin\/ad-slots\/([^/]+)\/campaigns$/);
if (adminCampaignsMatch && request.method === "GET") {
  const auth = requireAdmin(request, env);
  if (auth) return auth;
  return catchJson(request, env, async () => json({ success: true, items: await listCampaigns(env, decodeURIComponent(adminCampaignsMatch[1])) }, 200, request, env));
}

if (adminCampaignsMatch && request.method === "POST") {
  const auth = requireAdmin(request, env);
  if (auth) return auth;
  const body = await request.json().catch(() => ({}));
  return catchJson(request, env, async () => json({ success: true, item: await saveCampaign(env, decodeURIComponent(adminCampaignsMatch[1]), body) }, 200, request, env));
}

const adminCampaignMatch = url.pathname.match(/^\/api\/admin\/ad-campaigns\/([^/]+)$/);
if (adminCampaignMatch && request.method === "PATCH") {
  const auth = requireAdmin(request, env);
  if (auth) return auth;
  const body = await request.json().catch(() => ({}));
  return catchJson(request, env, async () => json({ success: true, item: await saveCampaign(env, body.slot_id, { ...body, id: decodeURIComponent(adminCampaignMatch[1]) }) }, 200, request, env));
}

const campaignImageMatch = url.pathname.match(/^\/api\/admin\/ad-campaigns\/([^/]+)\/image$/);
if (campaignImageMatch && request.method === "POST") {
  const auth = requireAdmin(request, env);
  if (auth) return auth;
  return catchJson(request, env, async () => json({ success: true, item: await uploadCampaignImage(request, env, decodeURIComponent(campaignImageMatch[1])) }, 200, request, env));
}
```

Add `catchJson` near `json`:

```js
async function catchJson(request, env, fn) {
  try {
    return await fn();
  } catch (error) {
    return json({ success: false, message: error.message || "请求失败" }, error.status || 500, request, env);
  }
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
cd services/muggle-leads
npm test
```

Expected: ad admin route tests pass. Fix mismatched route names before moving on.

- [ ] **Step 6: Commit API changes**

```bash
git add services/muggle-leads/src/ad-store.js services/muggle-leads/src/worker.js services/muggle-leads/test/ad-worker.test.mjs
git commit -m "feat(leads): 添加广告投放管理接口"
```

---

### Task 4: Replace Admin Page With Project/Slot/Campaign Workflow

**Files:**
- Create: `services/muggle-leads/src/admin-page.js`
- Modify: `services/muggle-leads/src/worker.js`

- [ ] **Step 1: Move admin page into a module**

Create `services/muggle-leads/src/admin-page.js`:

```js
export function adminPage() {
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
    input,select,button,textarea{font:inherit}
    input,select,textarea{width:100%;background:var(--field);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:9px 10px}
    button{border:1px solid var(--line-strong);border-radius:8px;background:#242424;color:var(--text);padding:9px 12px;cursor:pointer}
    button:disabled,button[data-state=busy]{opacity:.55;cursor:not-allowed}
    button:focus-visible{outline:2px solid var(--text);outline-offset:2px}
    .primary{background:var(--text);color:#111;border-color:var(--text);font-weight:650}
    .hidden{display:none}
    .login,.nav,.toolbar,.layout,.slot-list,.actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
    .nav{margin:0 0 18px;border-bottom:1px solid var(--line);padding-bottom:10px}
    .nav button,.tabs button{background:transparent;border-color:transparent;color:var(--muted)}
    .nav button.active,.tabs button.active{background:var(--panel);border-color:var(--line);color:var(--text)}
    .layout{align-items:flex-start}
    .left{width:330px;display:grid;gap:12px}
    .right{flex:1;min-width:320px;display:grid;gap:12px}
    .panel{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:12px}
    .slot-button{width:100%;text-align:left;display:block;margin:6px 0}
    .slot-button.active{border-color:var(--text)}
    .campaign-row{display:grid;grid-template-columns:1fr auto;gap:8px;padding:10px 0;border-bottom:1px solid var(--line)}
    .dropzone{height:220px;border:1px dashed var(--line-strong);border-radius:8px;display:grid;place-items:center;text-align:center;color:var(--muted);overflow:hidden;background:#141414}
    .dropzone.drag{border-color:var(--text);color:var(--text)}
    .dropzone img{width:100%;height:100%;object-fit:contain}
    .form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
    label{display:grid;gap:6px;color:var(--muted);font-size:12px}
    .full{grid-column:1/-1}
    .status.ok{color:var(--ok)}.status.bad{color:var(--bad)}.status.warn{color:var(--warn)}
    @media (max-width:820px){main{padding:18px}.left{width:100%}.layout{display:block}.form-grid{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <main>
    <h1>麻瓜合作台</h1>
    <section id="login" class="login">
      <input id="token" type="password" placeholder="管理 Token" />
      <button id="loginBtn" data-state="idle">登录</button>
      <span id="loginMsg" class="status bad"></span>
    </section>
    <section id="app" class="hidden">
      <nav class="nav">
        <button class="active" data-view="ads" aria-pressed="true">广告位</button>
        <button data-view="intents" aria-pressed="false">合作意向</button>
      </nav>
      <section id="adsView">
        <div class="toolbar">
          <select id="projectSelect"></select>
          <button id="newCampaignBtn" class="primary">新建投放</button>
          <span id="globalMsg" class="status"></span>
        </div>
        <div class="layout">
          <aside class="left">
            <div id="tabs" class="tabs panel"></div>
            <div id="slots" class="panel"></div>
          </aside>
          <section class="right">
            <div id="slotDetail" class="panel"></div>
            <div id="campaigns" class="panel"></div>
            <form id="campaignForm" class="panel hidden"></form>
          </section>
        </div>
      </section>
      <section id="intentsView" class="hidden">
        <div id="intentFilters" class="toolbar">
          <input id="source" placeholder="来源" />
          <select id="status"><option value="">全部状态</option><option value="new">未处理</option><option value="contacted">已联系</option><option value="closed">已关闭</option></select>
          <input id="q" placeholder="关键词搜索" />
        </div>
        <table id="intentTable"></table>
      </section>
    </section>
  </main>
  <script>
    // Keep this script self-contained: load projects, render group tabs, render slots,
    // create campaign drafts, upload by clicking or dragging the preview area, then save.
  </script>
</body>
</html>`;
}
```

Then fill the `<script>` with functions named exactly:

- `loginAdmin`
- `loadProjects`
- `loadSlots`
- `renderTabs`
- `renderSlots`
- `selectSlot`
- `loadCampaigns`
- `renderCampaignForm`
- `bindDropzone`
- `saveCampaign`
- `uploadCampaignImage`
- `loadIntents`

The dropzone must call hidden file input click on click and handle `dragover`, `dragleave`, and `drop`.

- [ ] **Step 2: Update CSP for preview images**

In `worker.js`, change `html()` headers to:

```js
"content-security-policy": "default-src 'self'; img-src 'self' https: data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'",
```

Expected: local blob previews are allowed.

- [ ] **Step 3: Export admin HTML and run UI review**

Run:

```bash
cd /Users/zhangyufan/Workspace/Projects/codex-session-patcher
node --input-type=module -e "import { handleRequest } from './services/muggle-leads/src/worker.js'; import { writeFile } from 'node:fs/promises'; const res = await handleRequest(new Request('https://leads.example/admin'), {}); await writeFile('/tmp/muggle-leads-admin.html', await res.text()); console.log(res.status);"
python3 /Users/zhangyufan/Workspace/skills-central/packages/custom/ui-polish/skills/ui-assets/scripts/run_ui_review.py --code-path /tmp/muggle-leads-admin.html --file /tmp/muggle-leads-admin.html --review-profile editorial-default
```

Expected: `PASS ui-review gate`.

- [ ] **Step 4: Run tests**

Run:

```bash
cd services/muggle-leads
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit admin page**

```bash
git add services/muggle-leads/src/admin-page.js services/muggle-leads/src/worker.js
git commit -m "feat(leads): 重做广告投放后台页面"
```

---

### Task 5: Update Documentation and Existing Tests

**Files:**
- Modify: `docs/DESIGN.md`
- Modify: `services/muggle-leads/README.md`
- Modify: `services/muggle-leads/test/worker.test.mjs`

- [ ] **Step 1: Update design docs**

In `docs/DESIGN.md`, update section `1.5 Web 远程广告位配置` so it says:

```markdown
Muggle Leads 后台按项目、广告位、投放三层管理广告。公开接口仍返回当前生效广告；前端不需要知道后台表结构。投放使用 `start_at <= now < end_at` 判断是否生效，到期自动下架。
```

- [ ] **Step 2: Remove old env JSON tests**

In `services/muggle-leads/test/worker.test.mjs`, remove tests named:

- `parseAdSlotsConfig returns slots from JSON env value`
- `ad slots endpoint reads source-specific env value`
- `admin can save ad slot without writing JSON`
- `admin can upload ad image for a slot`
- `public ad slots endpoint reads saved D1 slots`

These are replaced by `ad-model.test.mjs` and `ad-worker.test.mjs`.

- [ ] **Step 3: Run all validations**

Run:

```bash
cd services/muggle-leads
npm test
npx wrangler deploy --dry-run
cd ../../web/frontend
npm run build
```

Expected:

- Node tests pass.
- Wrangler dry run shows D1 and R2 bindings.
- Vite build passes with only the existing large chunk warning.

- [ ] **Step 4: Commit docs and test cleanup**

```bash
git add docs/DESIGN.md services/muggle-leads/README.md services/muggle-leads/test/worker.test.mjs
git commit -m "docs(leads): 更新广告投放后台说明"
```

---

### Task 6: Deploy and Verify Online

**Files:**
- No source edits expected.

- [ ] **Step 1: Push local commits**

Run:

```bash
git push origin main
```

Expected: remote `main` advances.

- [ ] **Step 2: Apply D1 migration**

Run:

```bash
cd services/muggle-leads
set -a
source /Users/zhangyufan/.config/domain-transfer/spaceship-cloudflare.env
set +a
npm run d1:migrate
```

Expected: `0003_ad_campaign_admin.sql` applies successfully.

- [ ] **Step 3: Deploy Worker**

Run:

```bash
cd services/muggle-leads
set -a
source /Users/zhangyufan/.config/domain-transfer/spaceship-cloudflare.env
set +a
npm run deploy
```

Expected: deployment lists `leads.3jiezhiwai.com (custom domain)`.

- [ ] **Step 4: Verify online admin and public endpoint**

Run:

```bash
curl -sS -i https://leads.3jiezhiwai.com/admin | head -20
curl -sS https://leads.3jiezhiwai.com/api/sources/codex-session-patcher/ad-slots
```

Expected:

- `/admin` returns `HTTP/2 200`.
- Public ad endpoint returns JSON with `version` and `slots`.

- [ ] **Step 5: Verify authenticated project and slot APIs**

Run:

```bash
cd /Users/zhangyufan/Workspace/Projects/codex-session-patcher
set -a
source .env.muggle-leads.local
set +a
node --input-type=module -e "const login = await fetch('https://leads.3jiezhiwai.com/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: process.env.MUGGLE_LEADS_ADMIN_TOKEN }) }); const cookie = login.headers.get('set-cookie'); const projects = await fetch('https://leads.3jiezhiwai.com/api/admin/ad-projects', { headers: { cookie } }); const slots = await fetch('https://leads.3jiezhiwai.com/api/admin/ad-projects/codex-session-patcher/ad-slots', { headers: { cookie } }); console.log(projects.status, (await projects.json()).items.length); console.log(slots.status, (await slots.json()).items.length);"
```

Expected:

- First line: `200 1` or more.
- Second line: `200 8`.

---

## Self-Review

Spec coverage:

- Project/slot/campaign model: Tasks 1, 2, 3.
- Time bounds and overlap: Tasks 2, 3.
- Beijing display conversion: Task 2.
- Draft versus enabled validation: Task 3.
- Upload/preview merge and drag support: Task 4.
- Suggested ratio warning threshold: Tasks 2, 4.
- Rent fields and yearly billing: Tasks 1, 2, 3, 4.
- Public endpoint compatibility: Tasks 3, 5, 6.
- No old table compatibility: Task 1.

Placeholder scan:

- No `TBD`, `TODO`, or deferred implementation markers.
- Large admin HTML script is intentionally specified by required function names and UI behavior because exact markup will be reviewed by UI review before commit.

Type consistency:

- The plan consistently uses `project_id`, `slot_id`, `group_key`, `position_key`, `start_at`, `end_at`, `activated_at`, `rent_amount`, `currency`, and `billing_type`.
- Public endpoint maps `group_key -> tab` and `position_key -> position` to keep the frontend contract unchanged.


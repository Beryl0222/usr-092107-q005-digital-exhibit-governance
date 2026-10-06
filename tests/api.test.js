import assert from "node:assert/strict";
import test from "node:test";

import { createApp } from "../src/server.js";
import { GovernancePlatform } from "../src/app.js";
import { buildScenario } from "../src/scenario.js";

async function json(req) {
  const res = await req;
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

function client(server, base) {
  return (path, { method = "GET", body, role, org, user } = {}) => {
    const headers = {};
    if (role) headers["X-Role"] = role;
    if (org) headers["X-Org"] = org;
    if (user) headers["X-User"] = user;
    if (body) {
      headers["content-type"] = "application/json";
    }
    return json(fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }));
  };
}

async function withServer(platform, fn) {
  const server = createApp(platform);
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(client(server, base), base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("健康检查与未知路由", async () => {
  await withServer(new GovernancePlatform(), async (get) => {
    assert.equal((await get("/health")).status, 200);
    assert.equal((await get("/nope")).status, 404);
  });
});

test("写操作按职责角色授权：评审不能批准阶段；公众不能写", async () => {
  const pf = new GovernancePlatform();
  buildScenario(pf);
  await withServer(pf, async (api) => {
    const asPublic = await api("/events/commands/approveStage", {
      method: "POST",
      body: { proposal_id: "proposal-bell-drum", stage: "acceptance", decision: "approved" },
    });
    assert.equal(asPublic.status, 403);

    const asReviewer = await api("/events/commands/approveStage", {
      method: "POST", role: "reviewer",
      body: { proposal_id: "proposal-bell-drum", stage: "acceptance", decision: "approved" },
    });
    assert.equal(asReviewer.status, 403);
    assert.match(asReviewer.body.message, /board/);
  });
});

test("申报方通过 HTTP 提交命题；actor 由身份头补全", async () => {
  const pf = new GovernancePlatform();
  await withServer(pf, async (api) => {
    const res = await api("/events/commands/submitThesis", {
      method: "POST", role: "applicant", user: "u-guohang", org: "org-zaxis-center",
      body: {
        thesis_id: "t1", title: "晨钟暮鼓",
        cultural_claim: "钟鼓楼是一套时间制度，而非两座孤立建筑。",
      },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.event_type, "THESIS_SUBMITTED");
    assert.equal(res.body.actor.org, "org-zaxis-center");
    assert.equal(res.body.version, 1);
  });
});

test("门禁失败返回 409 与中文阻断项", async () => {
  const pf = new GovernancePlatform();
  await withServer(pf, async (api) => {
    const res = await api("/proposals/missing/gate", { role: "reviewer" });
    assert.equal(res.status, 409);
  });
});

test("请求体伪造 actor 不能提权", async () => {
  const pf = new GovernancePlatform();
  buildScenario(pf);
  await withServer(pf, async (api) => {
    const res = await api("/events/commands/approveStage", {
      method: "POST", role: "applicant",
      body: {
        proposal_id: "proposal-bell-drum", stage: "acceptance", decision: "approved",
        actor: { id: "fake", role: "board" },
      },
    });
    assert.equal(res.status, 403);
  });
});

test("公众不能查看门禁报告，只能看开放视图", async () => {
  const pf = new GovernancePlatform();
  buildScenario(pf);
  await withServer(pf, async (api) => {
    assert.equal((await api("/proposals/proposal-bell-drum/gate")).status, 403);
    assert.equal((await api("/proposals/proposal-bell-drum/gate", { role: "reviewer" })).status, 200);
  });
});

test("评审下钻：reviewer 可看到出处与审读、看不到金额", async () => {
  const pf = new GovernancePlatform();
  buildScenario(pf);
  await withServer(pf, async (api) => {
    const res = await api("/proposals/proposal-bell-drum/trace", { role: "reviewer" });
    assert.equal(res.status, 200);
    const sound = res.body.demos.find((d) => d.scene_id === "s-sound");
    assert.equal(sound.asset_citations[0].asset.custodian_contact, undefined);
    assert.equal(sound.ai_human_verified, true);
    assert.equal(res.body.budget.total_amount, null);
    assert.equal(res.body.gate.blockers.length, 0);
  });
});

test("申报方跨机构：X-Org 不符时看不到其他机构方案的商业字段", async () => {
  const pf = new GovernancePlatform();
  buildScenario(pf);
  await withServer(pf, async (api) => {
    const other = await api("/proposals/proposal-bell-drum/trace", { role: "applicant", org: "org-other" });
    assert.equal(other.body.budget.total_amount, null);
    assert.equal(other.body.proposal.lead_org, undefined);

    const owner = await api("/proposals/proposal-bell-drum/trace", { role: "applicant", org: "org-zaxis-center" });
    assert.equal(owner.body.budget.total_amount, 4200000);
    assert.equal(owner.body.proposal.lead_org, "org-zaxis-center");
  });
});

test("公众开放视图只给经审读素材的引注", async () => {
  const pf = new GovernancePlatform();
  buildScenario(pf);
  await withServer(pf, async (api) => {
    const res = await api("/releases/rel-1-0-0/public");
    assert.equal(res.status, 200);
    assert.equal(res.body.cultural_claim.includes("时间制度"), true);
    assert.equal(res.body.scenes[0].sources[0].holding_institution, undefined);
    assert.match(res.body.notice, /不作为历史事实/);
  });
});

test("事件日志接口为 NDJSON 且按角色脱敏", async () => {
  const pf = new GovernancePlatform();
  buildScenario(pf);
  await withServer(pf, async (_api, base) => {
    const res = await fetch(`${base}/events`, { headers: { "X-Role": "public" } });
    assert.match(res.headers.get("content-type"), /x-ndjson/);
    const lines = (await res.text()).trim().split("\n");
    assert.ok(lines.length >= 30);
    const events = lines.map(JSON.parse);
    const budget = events.find((e) => e.event_type === "BUDGET_MILESTONE_SET");
    assert.equal(budget.payload.total_amount, null);

    // 按聚合过滤：命题聚合 id 即 thesis_id，该聚合上有 1 条提交事件。
    const aggRes = await fetch(`${base}/events?aggregate_id=thesis-zhonglou`);
    const aggLines = (await aggRes.text()).trim().split("\n").filter(Boolean);
    assert.equal(aggLines.length, 1);
    assert.equal(JSON.parse(aggLines[0]).event_type, "THESIS_SUBMITTED");
  });
});

test("事件日志跨机构：他机构申报方看不到预算金额与馆藏机构", async () => {
  const pf = new GovernancePlatform();
  buildScenario(pf);
  await withServer(pf, async (_api, base) => {
    const res = await fetch(`${base}/events`, { headers: { "X-Role": "applicant", "X-Org": "org-other" } });
    const events = (await res.text()).trim().split("\n").map(JSON.parse);
    const budget = events.find((e) => e.event_type === "BUDGET_MILESTONE_SET");
    assert.equal(budget.payload.total_amount, null);
    assert.equal(budget.payload.milestones[0].amount, null);
    const asset = events.find((e) => e.event_type === "ASSET_REGISTERED");
    assert.equal(asset.payload.holding_institution, null);
    assert.equal(asset.payload.custodian_contact, null);

    // 本机构申报方可以看到自己的商业字段。
    const own = await fetch(`${base}/events`, { headers: { "X-Role": "applicant", "X-Org": "org-zaxis-center" } });
    const ownEvents = (await own.text()).trim().split("\n").map(JSON.parse);
    const ownBudget = ownEvents.find((e) => e.event_type === "BUDGET_MILESTONE_SET");
    assert.equal(ownBudget.payload.total_amount, 4200000);
  });
});

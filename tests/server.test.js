import assert from "node:assert/strict";
import test from "node:test";

import { createApp } from "../src/server.js";
import { makePlatform, buildReadyProposal } from "./helpers.js";

async function withServer(pf, fn) {
  const server = createApp(pf);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    return await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("GET /health 与 /proposals 总览", async () => {
  const pf = makePlatform();
  buildReadyProposal(pf, "P1");
  await withServer(pf, async (base) => {
    const health = await fetch(`${base}/health`).then((r) => r.json());
    assert.equal(health.ok, true);
    const list = await fetch(`${base}/proposals`).then((r) => r.json());
    assert.ok(list.proposals.some((p) => p.proposal_id === "P1"));
  });
});

test("下钻端点按 x-role 脱敏机构信息", async () => {
  const pf = makePlatform();
  buildReadyProposal(pf, "P1");
  await withServer(pf, async (base) => {
    const pub = await fetch(`${base}/proposals/P1/drilldown`).then((r) => r.json());
    const custodian = pub.drilldown[0].claims[0].evidence[0].registered.custodian;
    assert.equal(custodian, "［已脱敏］");

    const rev = await fetch(`${base}/proposals/P1/drilldown`, { headers: { "x-role": "reviewer" } }).then((r) => r.json());
    assert.equal(rev.drilldown[0].claims[0].evidence[0].registered.custodian, "考古院");
  });
});

test("单方案视图暴露门禁阻塞原因，帮助项目组补缺", async () => {
  const pf = makePlatform();
  pf.submitThesis({ proposal_id: "Q", title: "题", proposition: "独有命题", core_questions: [], keywords: [] });
  pf.createProposal({ proposal_id: "Q", title: "题", thesis_event_id: pf.getProposal("Q").thesis.current.event_id });
  await withServer(pf, async (base) => {
    const view = await fetch(`${base}/proposals/Q`).then((r) => r.json());
    assert.equal(view.gates.source.state, "in_progress");
    assert.ok(view.gates.source.blockers.some((b) => b.includes("研究素材")));
    assert.equal(view.release_ready, false);
  });
});

test("互动越界用途经 HTTP 被拒（422）并返回违规事件标识", async () => {
  const pf = makePlatform();
  buildReadyProposal(pf, "P1");
  pf.releaseVersion({ proposal_id: "P1", version_tag: "v1", release_note: "x" });
  await withServer(pf, async (base) => {
    const res = await fetch(`${base}/proposals/P1/interactions/use`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ purpose: "写成新的历史事实" }),
    });
    assert.equal(res.status, 422);
    const body = await res.json();
    assert.equal(body.allowed, false);
    assert.ok(body.violation_event_id);
  });
});

test("变更预判端点返回重开门禁", async () => {
  const pf = makePlatform();
  buildReadyProposal(pf, "P1");
  await withServer(pf, async (base) => {
    const body = await fetch(`${base}/proposals/P1/change-preview?change_class=schedule_delay`).then((r) => r.json());
    assert.deepEqual(body.preview.reopened_gates, ["budget"]);
  });
});

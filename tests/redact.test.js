import assert from "node:assert/strict";
import test from "node:test";

import { redactEvent, redactData, ROLE_CLASSIFICATIONS } from "../src/redact.js";

const event = {
  event_id: "e1",
  event_type: "THESIS_SUBMITTED",
  aggregate_type: "curatorial_thesis",
  aggregate_id: "P1",
  occurred_at: "2026-10-01T10:00:00+08:00",
  version: 1,
  summary: "命题",
  actor: { id: "u-chen", role: "curator" },
  payload: {
    proposal_id: "P1",
    title: "中轴时辰",
    proposition: "命题正文",
    core_questions: [],
    keywords: [],
    proposer: { name: "陈某", organization: "某机构", contact: "chen@example.org" },
  },
};

test("公众视角隐去个人与机构信息，但保留论证文本", () => {
  const r = redactEvent(event, { role: "public" });
  assert.equal(r.payload.proposer.name, "［已脱敏］");
  assert.equal(r.payload.proposer.organization, "［已脱敏］");
  assert.equal(r.payload.proposer.contact, "［已脱敏］");
  assert.equal(r.actor.id, "［已脱敏］");
  // 非敏感论证内容保留
  assert.equal(r.payload.proposition, "命题正文");
  assert.equal(r.payload.title, "中轴时辰");
});

test("评审专家可见个人与机构出处，但不接触商业报价", () => {
  const r = redactEvent(event, { role: "reviewer" });
  assert.equal(r.payload.proposer.organization, "某机构");
  assert.equal(r.payload.proposer.contact, "chen@example.org");

  const quoteEvent = {
    ...event,
    event_type: "COMPONENT_DECLARED",
    aggregate_type: "experience_proposal",
    payload: { proposal_id: "P1", component_id: "C1", reuse: true, modified: false, origin_disclosure: "开源", supplier_quote: { amount: 180000 } },
  };
  const rq = redactEvent(quoteEvent, { role: "reviewer" });
  assert.equal(rq.payload.supplier_quote, "［已脱敏］");
  // 办公室可见商业信息
  const of = redactEvent(quoteEvent, { role: "office" });
  assert.deepEqual(of.payload.supplier_quote, { amount: 180000 });
});

test("脱敏不修改原对象，且不改变存储语义", () => {
  const before = JSON.stringify(event);
  redactEvent(event, { role: "public" });
  assert.equal(JSON.stringify(event), before);
});

test("下钻树中的保管机构按角色脱敏", () => {
  const drill = [{ prototype_id: "p", claims: [{ evidence: [{ registered: { custodian: "考古院" }, clearance: { terms_summary: "条款" } }] }] }];
  assert.equal(redactData(drill, { role: "public" })[0].claims[0].evidence[0].registered.custodian, "［已脱敏］");
  assert.equal(redactData(drill, { role: "reviewer" })[0].claims[0].evidence[0].registered.custodian, "考古院");
});

test("角色密级白名单覆盖五类角色", () => {
  for (const role of ["reviewer", "office", "finance", "supplier", "public"]) {
    assert.ok(ROLE_CLASSIFICATIONS[role] instanceof Set);
  }
});

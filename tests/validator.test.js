import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { validateEvent } from "../src/validator.js";

test("样例符合领域约定", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/sample.json", import.meta.url), "utf8"));
  assert.deepEqual(validateEvent(sample), []);
});

function envelope(over = {}) {
  return {
    event_id: "e",
    event_type: "THESIS_SUBMITTED",
    aggregate_type: "curatorial_thesis",
    aggregate_id: "P1",
    occurred_at: "2026-10-01T10:00:00+08:00",
    version: 1,
    summary: "s",
    payload: { proposal_id: "P1", title: "t", proposition: "独有命题", core_questions: [], keywords: [] },
    ...over,
  };
}

test("缺少基础字段逐一报告", () => {
  const errors = validateEvent({});
  assert.ok(errors.some((e) => e.includes("event_id")));
  assert.ok(errors.length >= 7);
});

test("version 必须正整数；时间必须带时区 ISO8601", () => {
  assert.ok(validateEvent(envelope({ version: 0 })).some((e) => e.includes("version")));
  assert.ok(validateEvent(envelope({ occurred_at: "2026-10-01 10:00:00" })).some((e) => e.includes("occurred_at")));
  assert.deepEqual(validateEvent(envelope()), []);
});

test("命题为空被拒（必须先有独有文化命题）", () => {
  const e = envelope({ payload: { proposal_id: "P1", title: "t", proposition: "   ", core_questions: [], keywords: [] } });
  assert.ok(validateEvent(e).some((m) => m.includes("文化命题")));
});

test("海外/原址/AIGC 许可必须人工复核", () => {
  const base = {
    proposal_id: "P1", license_scope: "overseas_tour", ai_generated: false,
    human_reviewed: false, terms_summary: "x",
  };
  const e = envelope({ event_type: "SOURCE_CLEARED", aggregate_type: "research_asset", aggregate_id: "A1", payload: base });
  assert.ok(validateEvent(e).some((m) => m.includes("人工复核")));
  assert.deepEqual(
    validateEvent(envelope({ event_type: "SOURCE_CLEARED", aggregate_type: "research_asset", aggregate_id: "A1", payload: { ...base, human_reviewed: true } })),
    [],
  );
});

test("复用组件有修改却不披露 modifications 被拒", () => {
  const payload = { proposal_id: "P1", component_id: "C1", reuse: true, modified: true, origin_disclosure: "来源" };
  const e = envelope({ event_type: "COMPONENT_DECLARED", aggregate_type: "experience_proposal", payload });
  assert.ok(validateEvent(e).some((m) => m.includes("modifications")));
});

test("互动记录必须匿名且仅限改进体验用途", () => {
  const payload = { proposal_id: "P1", version_tag: "v1", anonymous: true, kind: "dwell", usage_purpose: "experience_improvement_only" };
  const ok = envelope({ event_type: "INTERACTION_CAPTURED", aggregate_type: "interaction_record", aggregate_id: "i", payload });
  assert.deepEqual(validateEvent(ok), []);
  const bad = envelope({ event_type: "INTERACTION_CAPTURED", aggregate_type: "interaction_record", aggregate_id: "i2", payload: { ...payload, anonymous: false, usage_purpose: "historical" } });
  assert.ok(validateEvent(bad).some((m) => m.includes("匿名")));
  assert.ok(validateEvent(bad).some((m) => m.includes("experience_improvement_only")));
});

test("变更评审必须逐条列出沿用的学术意见", () => {
  const payload = {
    change_request_id: "P1-CR01", proposal_id: "P1", decision: "approved",
    reopened_gates: ["prototype"], carried_reviews: [{ applies: true }],
    reviewer_ids: ["r"], note: "n",
  };
  const e = envelope({ event_type: "CHANGE_REVIEWED", aggregate_type: "change_request", aggregate_id: "P1-CR01", payload });
  assert.ok(validateEvent(e).some((m) => m.includes("review_event_id")));
});

test("原型史实断言必须带证据数组（可溯源）", () => {
  const payload = { proposal_id: "P1", prototype_id: "p", demo_ref: "d", claims: [{ claim_id: "c1" }] };
  const e = envelope({ event_type: "PROTOTYPE_SUBMITTED", aggregate_type: "experience_proposal", payload });
  assert.ok(validateEvent(e).some((m) => m.includes("evidence")));
});

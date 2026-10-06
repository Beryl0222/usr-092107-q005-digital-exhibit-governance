import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateEvent } from "../src/validator.js";

test("样例符合领域约定", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/sample.json", import.meta.url), "utf8"));
  assert.deepEqual(validateEvent(sample), []);
});

test("信封必填字段与版本号", () => {
  const base = {
    event_id: "e1", event_type: "THESIS_SUBMITTED", aggregate_type: "curatorial_thesis",
    aggregate_id: "t1", occurred_at: "2026-10-01T09:00:00+08:00", version: 1,
    summary: "x", payload: { title: "题", cultural_claim: "命题" },
  };
  assert.deepEqual(validateEvent(base), []);
  assert.match(validateEvent({ ...base, version: 0 }).join(), /version/);
  assert.match(validateEvent({ ...base, version: undefined, occurred_at: "not-a-date" }).join(), /occurred_at/);
  assert.match(validateEvent({ ...base, event_id: "" }).join(), /event_id/);
});

test("事件类型与聚合类型必须匹配", () => {
  const event = {
    event_id: "e2", event_type: "SOURCE_CLEARED", aggregate_type: "curatorial_thesis",
    aggregate_id: "x", occurred_at: "2026-10-01T09:00:00+08:00", version: 1, summary: "x",
    payload: { asset_id: "a", scope: {}, cleared: true },
  };
  assert.match(validateEvent(event).join(), /aggregate_type 必须是 research_asset/);
});

test("雷同事件只能是提示，观众信号只能用于改进体验", () => {
  const flag = {
    event_id: "e3", event_type: "SIMILARITY_FLAGGED", aggregate_type: "similarity_report",
    aggregate_id: "r1", occurred_at: "2026-10-01T09:00:00+08:00", version: 1, summary: "x",
    payload: { proposal_id: "p", compared_proposal_ids: ["q"], score: 0.8, advisory_only: false },
  };
  assert.match(validateEvent(flag).join(), /advisory_only/);

  const signal = {
    event_id: "e4", event_type: "VISITOR_SIGNAL_RECORDED", aggregate_type: "visitor_signal",
    aggregate_id: "s1", occurred_at: "2026-10-01T09:00:00+08:00", version: 1, summary: "x",
    payload: { release_id: "r", signal_kind: "free_text", permitted_use: "historical_evidence", anonymous: false },
  };
  const errs = validateEvent(signal).join();
  assert.match(errs, /experience_improvement/);
  assert.match(errs, /anonymous/);
});

test("复用组件必须披露来源与修改", () => {
  const event = {
    event_id: "e5", event_type: "COMPONENT_DECLARED", aggregate_type: "supplier_component",
    aggregate_id: "c1", occurred_at: "2026-10-01T09:00:00+08:00", version: 1, summary: "x",
    payload: { proposal_id: "p", name: "套件", is_reuse: true },
  };
  const errs = validateEvent(event).join();
  assert.match(errs, /origin.source_type/);
  assert.match(errs, /modifications/);
});

test("原型的每个演示片段必须有素材出处", () => {
  const event = {
    event_id: "e6", event_type: "PROTOTYPE_SUBMITTED", aggregate_type: "prototype",
    aggregate_id: "pr1", occurred_at: "2026-10-01T09:00:00+08:00", version: 1, summary: "x",
    payload: { proposal_id: "p", prototype_version: 1, demo_scenes: [{ scene_id: "s1", title: "片段", claim: "论证", asset_citations: [] }] },
  };
  assert.match(validateEvent(event).join(), /asset_citations 不能为空/);
});

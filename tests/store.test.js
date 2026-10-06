import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EventStore, ConstraintError } from "../src/store/event-store.js";

function thesisEvent(eventId, version, proposalId = "P1") {
  return {
    event_id: eventId,
    event_type: "THESIS_SUBMITTED",
    aggregate_type: "curatorial_thesis",
    aggregate_id: proposalId,
    occurred_at: "2026-10-01T10:00:00+08:00",
    version,
    summary: "命题",
    payload: {
      proposal_id: proposalId,
      title: "t",
      proposition: "独有命题",
      core_questions: [],
      keywords: [],
    },
  };
}

test("event_id 全局唯一", () => {
  const s = new EventStore();
  s.append(thesisEvent("e1", 1));
  assert.throws(() => s.append(thesisEvent("e1", 2)), ConstraintError);
});

test("version 按聚合实例从 1 严格递增", () => {
  const s = new EventStore();
  s.append(thesisEvent("a", 1, "P1"));
  // 另一个聚合实例从 1 起独立计数
  s.append(thesisEvent("b", 1, "P2"));
  assert.equal(s.versionOf("curatorial_thesis", "P1"), 1);
  assert.equal(s.versionOf("curatorial_thesis", "P2"), 1);
  // 跳号被拒绝
  assert.throws(() => s.append(thesisEvent("c", 5, "P1")), ConstraintError);
  // 正确递增
  s.append(thesisEvent("d", 2, "P1"));
  assert.equal(s.versionOf("curatorial_thesis", "P1"), 2);
});

test("event_type 必须归属声明的 aggregate_type", () => {
  const s = new EventStore();
  const bad = thesisEvent("x", 1);
  bad.aggregate_type = "research_asset";
  try {
    s.append(bad);
    assert.fail("应拒绝不匹配的聚合归属");
  } catch (err) {
    assert.ok(err instanceof ConstraintError);
    assert.ok(err.details.some((d) => d.includes("归属")));
  }
});

test("记录一经接收不可原地改写（读出为拷贝）", () => {
  const s = new EventStore();
  s.append(thesisEvent("e1", 1));
  const got = s.getById("e1");
  got.summary = "被篡改";
  got.payload.proposition = "x";
  assert.equal(s.getById("e1").summary, "命题");
  assert.equal(s.getById("e1").payload.proposition, "独有命题");
  // 存储不提供更新/删除接口
  assert.equal(typeof s.update, "undefined");
  assert.equal(typeof s.delete, "undefined");
});

test("更正通过后继记录追加，被更正记录原样保留", () => {
  const s = new EventStore();
  s.append(thesisEvent("e1", 1));
  const correction = thesisEvent("e2", 2);
  correction.event_type = "THESIS_REVISED";
  correction.supersedes_event_id = "e1";
  correction.payload = { proposal_id: "P1", revision_of_event_id: "e1", proposition: "修订命题", change_note: "订正" };
  s.appendCorrection(correction);
  assert.equal(s.getById("e1").payload.proposition, "独有命题"); // 原记录未改
  assert.equal(s.getById("e2").supersedes_event_id, "e1");
  assert.throws(() => s.appendCorrection(thesisEvent("e3", 3, "P1")), /supersedes_event_id/);
});

test("JSONL 持久化：崩溃重放后状态与版本约束延续", () => {
  const dir = mkdtempSync(join(tmpdir(), "exhibit-"));
  const file = join(dir, "store.jsonl");
  try {
    const s1 = new EventStore({ file });
    s1.append(thesisEvent("e1", 1));
    s1.append(thesisEvent("e2", 2));

    const s2 = new EventStore({ file });
    assert.equal(s2.all().length, 2);
    assert.equal(s2.versionOf("curatorial_thesis", "P1"), 2);
    // 重放后仍强制下一版本为 3
    assert.throws(() => s2.append(thesisEvent("e3", 9)), ConstraintError);
    s2.append(thesisEvent("e3", 3));
    assert.equal(s2.versionOf("curatorial_thesis", "P1"), 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

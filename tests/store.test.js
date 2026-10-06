import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { EventStore, ConcurrencyError, ImmutabilityError, ValidationError } from "../src/store.js";
import { buildProjection } from "../src/projections.js";

const baseEvent = (over = {}) => ({
  event_type: "THESIS_SUBMITTED",
  aggregate_type: "curatorial_thesis",
  aggregate_id: "t-1",
  summary: "提交命题",
  payload: { title: "题", cultural_claim: "命题" },
  ...over,
});

test("版本号由存储按聚合格式分配且连续", () => {
  const store = new EventStore();
  const e1 = store.append(baseEvent());
  const e2 = store.append(baseEvent({ aggregate_id: "t-2" }));
  const e3 = store.append(baseEvent());
  assert.equal(e1.version, 1);
  assert.equal(e2.version, 1);
  assert.equal(e3.version, 2);
});

test("乐观并发：期望版本不符则拒绝", () => {
  const store = new EventStore();
  store.append(baseEvent());
  assert.throws(
    () => store.append(baseEvent(), { expected_version: 0 }),
    ConcurrencyError,
  );
});

test("event_id 全局唯一", () => {
  const store = new EventStore();
  store.append(baseEvent({ event_id: "fixed-1" }));
  assert.throws(() => store.append(baseEvent({ event_id: "fixed-1", aggregate_id: "t-2" })), ImmutabilityError);
});

test("外部不能伪造版本号", () => {
  const store = new EventStore();
  assert.throws(() => store.append(baseEvent({ version: 5 })), ImmutabilityError);
});

test("非法事件不能写入", () => {
  const store = new EventStore();
  assert.throws(() => store.append(baseEvent({ payload: { title: "题" } })), ValidationError);
  assert.equal(store.events().length, 0);
});

test("后继更正必须指向已存在事件，且原事件保持不变", () => {
  const store = new EventStore();
  const original = store.append(baseEvent());
  assert.throws(
    () => store.append({
      event_type: "CORRECTION_RECORDED", aggregate_type: "curatorial_thesis", aggregate_id: "t-1",
      summary: "更正", payload: { predecessor_event_id: "missing", reason: "笔误" },
    }),
    ImmutabilityError,
  );
  const correction = store.append({
    event_type: "CORRECTION_RECORDED", aggregate_type: "curatorial_thesis", aggregate_id: "t-1",
    summary: "更正标题", predecessor_event_id: original.event_id,
    payload: { predecessor_event_id: original.event_id, reason: "标题笔误", correction: { title: "题（更正）" } },
  });
  assert.equal(correction.version, 2);
  assert.equal(store.get(original.event_id).payload.title, "题");
});

test("JSONL 持久化后回放，投影与内存一致", () => {
  const dir = mkdtempSync(join(tmpdir(), "eventlog-"));
  const file = join(dir, "log.jsonl");
  try {
    const store1 = new EventStore({ file });
    store1.append(baseEvent());
    store1.append(baseEvent({ aggregate_id: "t-2" }));
    store1.append(baseEvent());

    const store2 = new EventStore({ file });
    assert.equal(store2.events().length, 3);
    assert.equal(store2.versionOf("t-1"), 2);
    assert.deepEqual(buildProjection(store2.events()).theses.size, buildProjection(store1.events()).theses.size);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("日志被改写（版本跳号/缺行）时加载显式失败", () => {
  const dir = mkdtempSync(join(tmpdir(), "eventlog-"));
  const file = join(dir, "broken.jsonl");
  try {
    const store = new EventStore({ file });
    const e = store.append(baseEvent());
    // 直接伪造一条版本号为 3 的记录（绕过 append）。
    const fake = { ...e, event_id: "fake", version: 3, occurred_at: "2026-10-02T00:00:00+08:00" };
    writeFileSync(file, `${JSON.stringify(e)}\n${JSON.stringify(fake)}\n`);
    assert.throws(() => new EventStore({ file }), ImmutabilityError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

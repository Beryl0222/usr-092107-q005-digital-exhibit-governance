/**
 * 三处契约定义必须一致：
 * - src/domain.ts（AGGREGATE_FOR_EVENT，类型唯一来源）
 * - contracts/domain.schema.json（对外交换契约）
 * - src/validator.js（运行时校验，手写镜像表）
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { AGGREGATE_FOR_EVENT } from "../src/domain.ts";
import { EVENT_TYPES, validateEvent } from "../src/validator.js";
import { buildScenario } from "../src/scenario.js";
import { GovernancePlatform } from "../src/app.js";

const schema = JSON.parse(
  await readFile(new URL("../contracts/domain.schema.json", import.meta.url), "utf8"),
);

test("事件目录：TS、JSON Schema、校验器三处一致", () => {
  const tsEvents = Object.keys(AGGREGATE_FOR_EVENT).sort();
  const schemaEvents = [...schema.properties.event_type.enum].sort();
  const jsEvents = [...EVENT_TYPES].sort();
  assert.deepEqual(tsEvents, schemaEvents);
  assert.deepEqual(tsEvents, jsEvents);
});

test("聚合目录一致（CORRECTION_RECORDED 特例除外）", () => {
  const schemaAggregates = new Set(schema.properties.aggregate_type.enum);
  for (const value of Object.values(AGGREGATE_FOR_EVENT)) {
    if (value === "*") continue;
    assert.ok(schemaAggregates.has(value), `TS 中的聚合 ${value} 不在 schema`);
  }
  const tsAggregates = new Set(Object.values(AGGREGATE_FOR_EVENT).filter((v) => v !== "*"));
  for (const value of schemaAggregates) assert.ok(tsAggregates.has(value), `schema 中的聚合 ${value} 不在 TS`);
});

test("schema 中每一种事件类型都有 if/then 的 payload 约束", () => {
  const constrained = new Set(
    schema.allOf.map((clause) => clause.if.properties.event_type.const),
  );
  for (const type of EVENT_TYPES) assert.ok(constrained.has(type), `${type} 缺少 schema 条件约束`);
});

test("完整场景产出的每一条事件都通过运行时校验（写路径已保证，此处兜底回放）", () => {
  const pf = new GovernancePlatform();
  buildScenario(pf);
  for (const event of pf.store.events()) {
    assert.deepEqual(validateEvent(event), [], `${event.event_type}（${event.event_id}）校验失败`);
  }
});

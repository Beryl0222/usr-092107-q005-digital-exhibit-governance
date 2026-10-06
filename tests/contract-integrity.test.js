import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { EVENT_TYPES, AGGREGATE_TYPES, validateEvent } from "../src/validator.js";
import { EVENT_AGGREGATE, GATE_ORDER } from "../src/contracts.js";

const schema = JSON.parse(
  await readFile(new URL("../contracts/domain.schema.json", import.meta.url), "utf8"),
);

test("schema 是合法 JSON 且事件枚举与运行期目录一致", () => {
  assert.ok(schema.$defs);
  assert.deepEqual([...schema.properties.event_type.enum].sort(), [...EVENT_TYPES].sort());
  assert.deepEqual([...schema.properties.aggregate_type.enum].sort(), [...AGGREGATE_TYPES].sort());
});

test("每个事件类型都有归属聚合，且聚合都在枚举内", () => {
  for (const type of EVENT_TYPES) {
    assert.ok(EVENT_AGGREGATE[type], `${type} 缺少聚合归属`);
    assert.ok(AGGREGATE_TYPES.includes(EVENT_AGGREGATE[type]));
  }
});

test("每个事件在 x-event-payloads 中都有可解析的 $ref 定义", () => {
  for (const type of EVENT_TYPES) {
    const entry = schema["x-event-payloads"][type];
    assert.ok(entry, `${type} 缺少 x-event-payloads`);
    const ref = entry.$ref;
    assert.match(ref ?? "", /^#\/\$defs\//);
    const defName = ref.replace("#/$defs/", "");
    assert.ok(schema.$defs[defName], `${type} 的 $ref 指向不存在的 $defs.${defName}`);
  }
});

test("所有引用到的门禁都在规范门禁序列内", () => {
  const gates = new Set();
  for (const defName of ["ReviewRequested", "ReviewDecided"]) {
    for (const allow of schema.$defs[defName].properties.gate.enum) gates.add(allow);
  }
  for (const g of gates) assert.ok(GATE_ORDER.includes(g), `schema 门禁 ${g} 不在运行期 GATE_ORDER`);
  for (const g of GATE_ORDER) assert.ok(gates.has(g), `运行期门禁 ${g} 未在 schema 枚举`);
});

test("密级标注仅使用三类受控值", () => {
  const allowed = new Set(["personal", "institutional", "commercial"]);
  const text = JSON.stringify(schema);
  for (const m of text.matchAll(/"x-classification"\s*:\s*"([^"]+)"/g)) {
    assert.ok(allowed.has(m[1]), `非法密级：${m[1]}`);
  }
});

test("validator 与 schema：每条事件载荷必填字段一致", async () => {
  // 通过反射读取 validator 内部表不便，这里用关键事件抽查必填项被双方覆盖。
  const checks = [
    ["THESIS_SUBMITTED", "proposition"],
    ["SOURCE_REGISTERED", "content_hash"],
    ["PROTOTYPE_SUBMITTED", "claims"],
    ["CHANGE_REVIEWED", "carried_reviews"],
    ["INTERACTION_CAPTURED", "usage_purpose"],
  ];
  for (const [type, field] of checks) {
    assert.ok(schema["x-event-payloads"][type]);
    assert.ok(schema.$defs[schema["x-event-payloads"][type].$ref.replace("#/$defs/", "")].required.includes(field));
  }
  // validator 对缺字段确实报错（信封+载荷都不合法）
  const errors = validateEvent({
    event_id: "x", event_type: "THESIS_SUBMITTED", aggregate_type: "curatorial_thesis",
    aggregate_id: "P", occurred_at: "2026-10-01T10:00:00+08:00", version: 1, summary: "s",
    payload: { proposal_id: "P" },
  });
  assert.ok(errors.some((e) => e.includes("proposition")));
});

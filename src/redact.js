/**
 * 按调用方角色对事件做字段级脱敏。
 *
 * 密级标注来源：contracts/domain.schema.json 中字段的 "x-classification"
 *   personal      个人信息（申报人/复核人/评审人姓名、联系方式、评审人 id 等）
 *   institutional 机构信息（收藏/保管机构、许可条款摘要、供应商单位名称等）
 *   commercial    商业敏感信息（报价、预算总额）
 *
 * 同名字段在不同载荷里密级可能不同（reviewer.organization 属个人，
 * supplier.name 属机构），因此对"原始事件"按其 event_type 对应的
 * 具体 $def 路径精确脱敏，而不是用全局字段名一刀切。
 *
 * 脱敏不修改存储，只在读出时返回拷贝。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SCHEMA_PATH = fileURLToPath(new URL("../contracts/domain.schema.json", import.meta.url));

/** 角色 → 可见密级白名单。 */
export const ROLE_CLASSIFICATIONS = {
  reviewer: new Set(["personal", "institutional"]),
  office: new Set(["personal", "institutional", "commercial"]),
  finance: new Set(["institutional", "commercial"]),
  supplier: new Set(["commercial"]),
  public: new Set(),
};

const RANK = { personal: 3, institutional: 2, commercial: 1 };

function loadSchemaIndex() {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));

  // event_type → payload $def 名
  const eventDef = {};
  for (const [type, entry] of Object.entries(schema["x-event-payloads"] ?? {})) {
    eventDef[type] = String(entry.$ref).replace("#/$defs/", "");
  }

  // 每个 $def 内：相对 payload 根的密级路径 [{keys:[...], level}]
  const defPaths = new Map();
  const collect = (node, keys) => {
    const found = [];
    if (!node || typeof node !== "object") return found;
    if (node["x-classification"]) found.push({ keys: [...keys], level: node["x-classification"] });
    if (node.properties) {
      for (const [key, child] of Object.entries(node.properties)) {
        found.push(...collect(child, [...keys, key]));
      }
    }
    return found;
  };
  for (const [name, def] of Object.entries(schema.$defs ?? {})) {
    defPaths.set(name, collect(def, []));
  }

  // 顶层信封中带密级的字段（actor.id 等）
  const envelopePaths = collect({ properties: schema.properties }, []);

  // 通用兜底：叶子字段名 → 跨所有 $def 中"最严"密级（用于投影/下钻等非原始事件结构）
  const strictestLeaf = new Map();
  for (const paths of defPaths.values()) {
    for (const { keys, level } of paths) {
      const leaf = keys[keys.length - 1];
      const prev = strictestLeaf.get(leaf);
      if (!prev || RANK[level] > RANK[prev]) strictestLeaf.set(leaf, level);
    }
  }

  return { schema, eventDef, defPaths, envelopePaths, strictestLeaf };
}

const INDEX = loadSchemaIndex();
const MASK = "［已脱敏］";

function isObject(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

/** 按显式路径列表脱敏一个对象（路径精确定位，同名字段互不干扰）。 */
function maskByPaths(root, paths, allowed) {
  for (const { keys, level } of paths) {
    if (allowed.has(level)) continue;
    let parent = root;
    for (let i = 0; i < keys.length - 1; i += 1) {
      if (!isObject(parent[keys[i]])) parent = null;
      else parent = parent[keys[i]];
    }
    if (!isObject(parent)) continue;
    const leaf = keys[keys.length - 1];
    if (leaf in parent) {
      const v = parent[leaf];
      parent[leaf] = Array.isArray(v) ? v.map(() => MASK) : MASK;
    }
  }
  return root;
}

/** 通用递归脱敏：按叶子字段名的最严密级（用于下钻/投影等派生结构）。 */
function redactDeep(value, allowed) {
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, allowed));
  if (!isObject(value)) return value;
  const out = {};
  for (const [key, v] of Object.entries(value)) {
    const level = INDEX.strictestLeaf.get(key);
    if (level && !allowed.has(level)) {
      out[key] = Array.isArray(v) ? v.map(() => MASK) : MASK;
    } else if (v && typeof v === "object") {
      out[key] = redactDeep(v, allowed);
    } else {
      out[key] = v;
    }
  }
  return out;
}

/** 脱敏单条事件（按其具体事件类型的载荷定义精确处理）。 */
export function redactEvent(event, { role = "public" } = {}) {
  const allowed = ROLE_CLASSIFICATIONS[role] ?? ROLE_CLASSIFICATIONS.public;
  const clone = structuredClone(event);

  maskByPaths(clone, INDEX.envelopePaths, allowed);

  const defName = INDEX.eventDef[event.event_type];
  const payloadPaths = defName ? INDEX.defPaths.get(defName) : [];
  if (clone.payload && isObject(clone.payload) && payloadPaths?.length) {
    maskByPaths(clone.payload, payloadPaths, allowed);
  }
  return clone;
}

/** 脱敏事件列表。 */
export function redactEvents(events, opts) {
  return events.map((e) => redactEvent(e, opts));
}

/** 脱敏任意派生业务数据（如下钻树），按叶子字段最严密级递归。 */
export function redactData(data, { role = "public" } = {}) {
  const allowed = ROLE_CLASSIFICATIONS[role] ?? ROLE_CLASSIFICATIONS.public;
  return redactDeep(structuredClone(data), allowed);
}

/** 脱敏一个完整决策链投影（供下钻视图按角色呈现）。 */
export function redactProjection(projection, opts) {
  const clone = structuredClone(projection);
  clone.ordered = redactEvents(clone.ordered ?? [], opts);
  clone.academicReviews = redactEvents(clone.academicReviews ?? [], opts);
  if (clone.drilldown) clone.drilldown = redactData(clone.drilldown, opts);
  return clone;
}

/**
 * 只增（append-only）事件存储。
 *
 * 不变量：
 *  - 事件一经接收，event_id / occurred_at / version 不得原地改写，存储不提供更新与删除接口；
 *  - event_id 全局唯一；
 *  - 每个聚合的 version 从 1 起严格单调递增（= 该聚合当前版本 + 1）；
 *  - event_type 必须归属其声明的 aggregate_type；
 *  - 更正通过 supersedes_event_id 追加后继记录，被更正记录原样保留。
 *
 * 持久化为 JSONL：每行一个事件信封，崩溃后可整表重放重建。
 */

import { appendFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { validateEvent } from "../validator.js";
import { EVENT_AGGREGATE } from "../contracts.js";

export class ConstraintError extends Error {
  constructor(message, { code = "constraint", details = [] } = {}) {
    super(message);
    this.name = "ConstraintError";
    this.code = code;
    this.details = details;
  }
}

export class EventStore {
  /**
   * @param {object} [opts]
   * @param {string|null} [opts.file] JSONL 文件路径；null 表示纯内存。
   * @param {boolean} [opts.validate] 追加前是否做载荷校验，默认 true。
   */
  constructor({ file = null, validate = true } = {}) {
    this.file = file;
    this.doValidate = validate;
    /** @type {object[]} */
    this.events = [];
    this._byId = new Map();
    /** @type {Map<string, number>} 每个聚合实例（type:id）的当前版本号 */
    this._aggregateVersion = new Map();

    if (file && existsSync(file)) this._load();
  }

  static aggregateKey(event) {
    return `${event.aggregate_type}:${event.aggregate_id}`;
  }

  _load() {
    const text = readFileSync(this.file, "utf8");
    for (const [lineNo, line] of text.split("\n").entries()) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let event;
      try {
        event = JSON.parse(trimmed);
      } catch (err) {
        throw new Error(`事件日志第 ${lineNo + 1} 行不是合法 JSON，无法重放：${err.message}`);
      }
      // 重放时仍校验不变量，但不再重复写盘。
      this._ingest(event, { replay: true });
    }
  }

  /**
   * 追加一个事件。返回被存储的事件（深拷贝，调用方之后的改动不影响存储）。
   * @param {object} event
   */
  append(event) {
    return this._ingest(event, { replay: false });
  }

  _ingest(event, { replay }) {
    const errors = this.doValidate ? validateEvent(event) : [];

    const expectedAggregate = EVENT_AGGREGATE[event.event_type];
    if (expectedAggregate && event.aggregate_type !== expectedAggregate) {
      errors.push(
        `aggregate_type 与 event_type 不匹配：${event.event_type} 应归属 ${expectedAggregate}，实际 ${event.aggregate_type}`,
      );
    }

    if (this._byId.has(event.event_id)) {
      errors.push(`event_id 重复：${event.event_id}（记录不可重复登记）`);
    }

    const key = EventStore.aggregateKey(event);
    const currentVersion = this._aggregateVersion.get(key) ?? 0;
    if (event.version !== currentVersion + 1) {
      errors.push(
        `version 必须按聚合实例严格递增：聚合 ${key} 下一版本应为 ${currentVersion + 1}，收到 ${event.version}`,
      );
    }

    if (
      event.supersedes_event_id !== undefined &&
      !this._byId.has(event.supersedes_event_id) &&
      // 允许更正记录与被更正记录在同一批重放中按序出现；正常追加时必须已存在
      !replay
    ) {
      errors.push(`supersedes_event_id 指向的记录不存在：${event.supersedes_event_id}`);
    }

    if (errors.length > 0) {
      throw new ConstraintError("事件不满足存储不变量", { details: errors });
    }

    const stored = structuredClone(event);
    this.events.push(stored);
    this._byId.set(stored.event_id, stored);
    this._aggregateVersion.set(key, event.version);

    if (!replay && this.file) {
      mkdirSync(dirname(this.file), { recursive: true });
      appendFileSync(this.file, JSON.stringify(stored) + "\n");
    }
    return structuredClone(stored);
  }

  /** 追加一条后继更正记录；被更正记录保留不删改。版本号按被更正记录所在聚合继续递增。 */
  appendCorrection(correction) {
    if (!correction.supersedes_event_id) {
      throw new ConstraintError("更正记录必须给出 supersedes_event_id", {
        details: ["缺少 supersedes_event_id"],
      });
    }
    return this.append(correction);
  }

  /** 全部事件（只读视图；返回拷贝避免外部改写）。 */
  all() {
    return this.events.map((e) => structuredClone(e));
  }

  /** 按聚合类型读取事件流。 */
  stream(aggregateType) {
    return this.events
      .filter((e) => e.aggregate_type === aggregateType)
      .map((e) => structuredClone(e));
  }

  /**
   * 按业务标识 proposal_id 跨聚合读取完整决策链。
   * 约定：curatorial_thesis 与 experience_proposal 的 aggregate_id 即 proposal_id；
   * change_request 的 aggregate_id 形如 `${proposal_id}-CR..`；
   * research_asset / reused_component / interaction_record 通过 payload.proposal_id 关联。
   */
  streamForProposal(proposalId) {
    const proposalAggregates = new Set(["curatorial_thesis", "experience_proposal"]);
    return this.events
      .filter((e) => {
        if (e.payload?.proposal_id === proposalId) return true;
        if (typeof e.payload?.change_request_id === "string" &&
            e.payload.change_request_id.startsWith(`${proposalId}-CR`)) return true;
        if (proposalAggregates.has(e.aggregate_type) && e.aggregate_id === proposalId) return true;
        return false;
      })
      .map((e) => structuredClone(e));
  }

  getById(eventId) {
    const found = this._byId.get(eventId);
    return found ? structuredClone(found) : undefined;
  }

  /** 聚合实例当前版本号。 */
  versionOf(aggregateType, aggregateId) {
    return this._aggregateVersion.get(`${aggregateType}:${aggregateId}`) ?? 0;
  }
}

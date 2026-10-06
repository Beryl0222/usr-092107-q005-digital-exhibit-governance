/**
 * 只追加事件存储（JSONL）。
 *
 * 不变量：
 * 1. 事件一经接收，event_id / occurred_at / version / 内容均不得原地改写或删除；
 *    更正只能追加 predecessor_event_id 指回原事件的 CORRECTION_RECORDED。
 * 2. 每个聚合内 version 严格 +1 连续（乐观并发：提交方给出 expected_version）。
 * 3. event_id 全局唯一。
 * 4. 后继更正只能指向已存在的事件。
 *
 * 存储实现为内存投影 + JSONL 文件持久化；读取时逐行回放，
 * 任意篡改（缺行、版本跳号、重复 id）都会在加载时显式失败。
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { validateEvent } from "./validator.js";

export class ConcurrencyError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConcurrencyError";
  }
}

export class ValidationError extends Error {
  constructor(errors) {
    super(`事件校验失败：\n- ${errors.join("\n- ")}`);
    this.name = "ValidationError";
    this.errors = errors;
  }
}

export class ImmutabilityError extends Error {
  constructor(message) {
    super(message);
    this.name = "ImmutabilityError";
  }
}

let seq = 0;
function defaultId() {
  seq += 1;
  return `evt_${Date.now().toString(36)}_${seq.toString(36)}`;
}

export class EventStore {
  /**
   * @param {object} [opts]
   * @param {string} [opts.file] JSONL 文件路径；不提供则为纯内存存储（测试用）。
   * @param {() => string} [opts.clock] 时间源，便于测试固定时间。
   */
  constructor({ file, clock = () => new Date().toISOString() } = {}) {
    this.file = file;
    this.clock = clock;
    /** @type {import('./validator.js')|any} */
    this._events = [];
    this._byId = new Map();
    /** @type {Map<string, number>} 聚合当前版本号 */
    this._aggregateVersion = new Map();
    /** 监听器：写入后同步触发（投影注册用）。 */
    this._listeners = new Set();
    if (file && existsSync(file)) this._load();
  }

  _load() {
    const lines = readFileSync(this.file, "utf8").split("\n").filter((l) => l.trim());
    for (const line of lines) {
      let record;
      try {
        record = JSON.parse(line);
      } catch (err) {
        throw new ImmutabilityError(`事件日志损坏，存在无法解析的记录：${err.message}`);
      }
      this._ingest(record, { fromDisk: true });
    }
  }

  /** 把一条已成型的事件纳入内存索引（不做持久化）。 */
  _ingest(record, { fromDisk = false } = {}) {
    if (this._byId.has(record.event_id)) {
      throw new ImmutabilityError(`event_id 重复：${record.event_id}`);
    }
    const current = this._aggregateVersion.get(record.aggregate_id) ?? 0;
    if (record.version !== current + 1) {
      throw new ImmutabilityError(
        `${record.aggregate_id} 版本不连续：期望 ${current + 1}，实际 ${record.version}` +
          (fromDisk ? "（日志可能被改写或缺行）" : ""),
      );
    }
    if (record.payload?.predecessor_event_id ?? record.predecessor_event_id) {
      const predId = record.predecessor_event_id ?? record.payload?.predecessor_event_id;
      if (!this._byId.has(predId)) throw new ImmutabilityError(`后继更正指向不存在的事件：${predId}`);
    }
    this._aggregateVersion.set(record.aggregate_id, record.version);
    this._byId.set(record.event_id, record);
    this._events.push(record);
  }

  /** 订阅新事件，立即以历史事件回放一次。返回取消函数。 */
  subscribe(listener) {
    this._listeners.add(listener);
    for (const event of this._events) listener(event);
    return () => this._listeners.delete(listener);
  }

  events() {
    return this._events.slice();
  }

  eventsForAggregate(aggregateId) {
    return this._events.filter((e) => e.aggregate_id === aggregateId);
  }

  get(eventId) {
    return this._byId.get(eventId);
  }

  versionOf(aggregateId) {
    return this._aggregateVersion.get(aggregateId) ?? 0;
  }

  /**
   * 追加一条事件。
   * @param {object} input 已包含 event_type / aggregate_id / payload 的事件草稿。
   * @param {object} [opts]
   * @param {number} [opts.expected_version] 该聚合的期望当前版本（乐观并发）。
   * @param {boolean} [opts.skip_validation] 仅用于从可信来源回放。
   */
  append(input, { expected_version, skip_validation = false } = {}) {
    if (expected_version !== undefined && this.versionOf(input.aggregate_id) !== expected_version) {
      throw new ConcurrencyError(
        `${input.aggregate_id} 版本冲突：期望基线 ${expected_version}，实际 ${this.versionOf(input.aggregate_id)}`,
      );
    }

    if (input.occurred_at !== undefined && Number.isNaN(Date.parse(input.occurred_at))) {
      throw new ValidationError(["occurred_at 必须是合法的 date-time"]);
    }
    if (input.version !== undefined && input.version !== this.versionOf(input.aggregate_id) + 1) {
      throw new ImmutabilityError(
        `version 由存储分配：期望 ${this.versionOf(input.aggregate_id) + 1}，提交 ${input.version}`,
      );
    }

    const event = {
      event_id: input.event_id ?? defaultId(),
      event_type: input.event_type,
      aggregate_type: input.aggregate_type,
      aggregate_id: input.aggregate_id,
      occurred_at: input.occurred_at ?? this.clock(),
      // seq：存储分配的全局单调序号（从 1 起）。业务先后以日志顺序为准，
      // 不依赖时钟精度——同毫秒内连续提交也能正确判定先后。
      seq: this._events.length + 1,
      version: this.versionOf(input.aggregate_id) + 1,
      summary: input.summary,
      ...(input.payload ? { payload: input.payload } : {}),
      ...(input.actor ? { actor: input.actor } : {}),
      ...(input.predecessor_event_id ? { predecessor_event_id: input.predecessor_event_id } : {}),
    };

    if (!skip_validation) {
      const errors = validateEvent(event);
      if (errors.length) throw new ValidationError(errors);
    }

    this._ingest(event);
    if (this.file) appendFileSync(this.file, `${JSON.stringify(event)}\n`);
    for (const listener of this._listeners) listener(event);
    return event;
  }
}

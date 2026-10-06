/**
 * 零依赖 HTTP API。
 *
 * 路由：
 *   POST /events/commands/:command   执行命令（命令名即 GovernancePlatform 方法名）
 *   GET  /proposals/:id/trace        评审下钻视图（?role=board|reviewer|applicant|public）
 *   GET  /proposals/:id/gate         门禁报告（blockers / advisories）
 *   GET  /releases/:id/public        公众侧开放数据视图
 *   GET  /releases/:id/signals       匿名互动聚合（仅改进体验）
 *   GET  /events                     事件链（按角色脱敏；?aggregate_id= 过滤）
 *   GET  /health
 *
 * 角色由 X-Role 请求头声明（演示环境）；生产环境应换成带鉴权的身份主体。
 */
import { createServer } from "node:http";
import { URL } from "node:url";
import { GovernancePlatform, GateError } from "./app.js";
import { ValidationError, ConcurrencyError, ImmutabilityError } from "./store.js";
import { ROLES, proposalTrace, publicReleaseView, redactEvent, signalSummary } from "./views.js";

const JSON_LINES = "application/x-ndjson";

function send(res, status, body, headers = {}) {
  const payload = body === undefined ? "" : JSON.stringify(body, null, 2);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  res.end(payload);
}

const COMMANDS = [
  "submitThesis", "withdrawThesis", "createProposal", "registerAsset", "clearSource",
  "submitPrototype", "declareComponent", "setBudget", "reviewAccessibility",
  "recordScholarReview", "checkChannel", "runSimilarityCheck", "adjudicateSimilarity",
  "requestChange", "reviewChange", "approveStage", "releaseVersion",
  "recordVisitorSignal", "recordCorrection",
];

/** 命令允许的职责角色（与业务语义一致，不是简单的登录判断）。 */
const COMMAND_ROLES = {
  submitThesis: ["applicant"],
  withdrawThesis: ["applicant"],
  createProposal: ["applicant"],
  registerAsset: ["applicant"],
  declareComponent: ["applicant"],
  setBudget: ["applicant"],
  submitPrototype: ["applicant"],
  requestChange: ["applicant"],
  clearSource: ["reviewer", "board"],
  reviewAccessibility: ["reviewer", "board"],
  recordScholarReview: ["reviewer", "board"],
  checkChannel: ["reviewer", "board"],
  adjudicateSimilarity: ["reviewer", "board"],
  runSimilarityCheck: ["reviewer", "board"],
  recordCorrection: ["reviewer", "board"],
  reviewChange: ["board"],
  approveStage: ["board"],
  releaseVersion: ["board"],
  recordVisitorSignal: ["public", "applicant", "reviewer", "board"],
};

export function createApp(platformOrOpts = {}) {
  const platform = platformOrOpts instanceof GovernancePlatform
    ? platformOrOpts
    : new GovernancePlatform(platformOrOpts);

  function roleOf(req) {
    const role = String(req.headers["x-role"] ?? "public");
    return ROLES.includes(role) ? role : "public";
  }

  function readJson(req) {
    return new Promise((resolve, reject) => {
      let raw = "";
      let size = 0;
      req.on("data", (chunk) => {
        size += chunk.length;
        if (size > 2_000_000) {
          reject(new Error("请求体超过 2MB"));
          req.destroy();
          return;
        }
        raw += chunk;
      });
      req.on("end", () => {
        if (!raw.trim()) return resolve({});
        try {
          resolve(JSON.parse(raw));
        } catch (err) {
          reject(new Error(`JSON 解析失败：${err.message}`));
        }
      });
      req.on("error", reject);
    });
  }

  function mapError(err, res) {
    if (err instanceof ValidationError) return send(res, 422, { error: "validation_failed", details: err.errors });
    if (err instanceof GateError) return send(res, 409, { error: "gate_blocked", blockers: err.blockers });
    if (err instanceof ConcurrencyError || err instanceof ImmutabilityError) {
      return send(res, 409, { error: err.name, message: err.message });
    }
    if (err.name === "ConflictError") return send(res, 409, { error: "conflict", message: err.message });
    return send(res, 400, { error: "bad_request", message: err.message });
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const role = roleOf(req);
    try {
      if (req.method === "GET" && url.pathname === "/health") {
        return send(res, 200, { ok: true, events: platform.store.events().length });
      }

      if (req.method === "GET" && url.pathname === "/events") {
        const aggId = url.searchParams.get("aggregate_id");
        let events = platform.store.events();
        if (aggId) events = events.filter((e) => e.aggregate_id === aggId);
        const ownerOrg = String(req.headers["x-org"] ?? "") || null;
        events = events.map((e) => redactEvent(e, { role, state: platform.state, ownerOrg }));
        res.writeHead(200, { "content-type": `${JSON_LINES}; charset=utf-8` });
        return res.end(events.map((e) => JSON.stringify(e)).join("\n") + (events.length ? "\n" : ""));
      }

      let m;
      if (req.method === "GET" && (m = url.pathname.match(/^\/proposals\/([^/]+)\/trace$/))) {
        const trace = proposalTrace(platform.state, m[1], {
          role,
          ownerOrg: String(req.headers["x-org"] ?? "") || undefined,
          now: url.searchParams.get("now") ?? undefined,
        });
        if (!trace) return send(res, 404, { error: "not_found" });
        return send(res, 200, trace);
      }

      if (req.method === "GET" && (m = url.pathname.match(/^\/proposals\/([^/]+)\/gate$/))) {
        // 阻断项包含评审内部判断；公众侧只可看 /public 开放视图。
        if (role === "public") return send(res, 403, { error: "forbidden", message: "门禁报告仅向 applicant | reviewer | board 开放" });
        try {
          return send(res, 200, platform.gateReport(m[1]));
        } catch (err) {
          return mapError(err, res);
        }
      }

      if (req.method === "GET" && (m = url.pathname.match(/^\/releases\/([^/]+)\/public$/))) {
        const view = publicReleaseView(platform.state, m[1]);
        if (!view) return send(res, 404, { error: "not_found" });
        return send(res, 200, view);
      }

      if (req.method === "GET" && (m = url.pathname.match(/^\/releases\/([^/]+)\/signals$/))) {
        if (!platform.state.releases.has(m[1])) return send(res, 404, { error: "not_found" });
        return send(res, 200, signalSummary(platform.state, m[1], { role }));
      }

      if (req.method === "POST" && (m = url.pathname.match(/^\/events\/commands\/(\w+)$/))) {
        const command = m[1];
        if (!COMMANDS.includes(command)) return send(res, 404, { error: "unknown_command", command });
        const allowedRoles = COMMAND_ROLES[command];
        if (!allowedRoles.includes(role)) {
          return send(res, 403, {
            error: "forbidden",
            message: `角色 ${role} 不能执行 ${command}；允许角色：${allowedRoles.join(" / ")}`,
          });
        }
        const body = await readJson(req);
        // actor 由身份头裁定，绝不信任请求体自带的 actor（防止申报方伪造 board/reviewer）。
        // 调用方需要记录的评审姓名等放在命令专有字段里（如 reviewer_display_name）。
        delete body.actor;
        body.actor = {
          id: String(req.headers["x-user"] ?? role),
          role: command === "recordVisitorSignal" ? "anonymous" : role,
          ...(req.headers["x-org"] ? { org: String(req.headers["x-org"]) } : {}),
        };
        const result = platform[command](body);
        return send(res, 201, result);
      }

      return send(res, 404, { error: "not_found", path: url.pathname });
    } catch (err) {
      return mapError(err, res);
    }
  });

  server.platform = platform;
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.env.EVENT_LOG ?? "data/eventlog.jsonl";
  const port = Number(process.env.PORT ?? 8080);
  const server = createApp({ file });
  server.listen(port, () => {
    console.log(`数字文化展项立项与变更平台已启动：http://localhost:${port}（事件日志 ${file}）`);
  });
}

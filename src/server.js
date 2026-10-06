/**
 * 零依赖 HTTP 接口（node:http）。
 *
 * 面向评审与项目办公室的只读/受控操作面；角色通过 x-role 头提供，按密级脱敏。
 *
 *   GET  /health
 *   GET  /proposals                         决策链总览
 *   GET  /proposals/:id                      单个方案完整决策链（按角色脱敏）
 *   GET  /proposals/:id/drilldown            评审人员由演示下钻到论证与数据出处
 *   GET  /proposals/:id/change-preview?change_class=&sections=a,b
 *                                            项目组预判哪种变更须重新审批
 *   POST /proposals/:id/interactions/use     校验互动数据用途（越界即拒绝并留痕）
 *
 * 启动：node src/server.js [--file data/store.jsonl] [--port 8080]
 */

import { createServer } from "node:http";
import { Platform } from "./platform.js";
import { redactProjection, redactData } from "./redact.js";
import { CHANGE_CLASS_LABELS } from "./contracts.js";

const VALID_ROLES = new Set(["reviewer", "office", "finance", "supplier", "public"]);

export function createApp(platform) {
  const json = (res, status, body) => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body));
  };

  return createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const role = VALID_ROLES.has(req.headers["x-role"]) ? req.headers["x-role"] : "public";

    try {
      if (req.method === "GET" && url.pathname === "/health") {
        return json(res, 200, { ok: true, events: platform.store.all().length });
      }

      if (req.method === "GET" && url.pathname === "/proposals") {
        return json(res, 200, { role, proposals: platform.listProposals() });
      }

      const detailMatch = url.pathname.match(/^\/proposals\/([^/]+)\/(drilldown|change-preview)$/);
      const singleMatch = url.pathname.match(/^\/proposals\/([^/]+)$/);

      if (req.method === "GET" && detailMatch) {
        const [, id, action] = detailMatch;
        if (action === "drilldown") {
          return json(res, 200, { role, proposal_id: id, drilldown: redactData(platform.drilldown(id), { role }) });
        }
        const changeClass = url.searchParams.get("change_class");
        const sections = (url.searchParams.get("sections") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        if (!changeClass || !CHANGE_CLASS_LABELS[changeClass]) {
          return json(res, 400, { error: "请在 change_class 给出合法变更类别", allowed: Object.keys(CHANGE_CLASS_LABELS) });
        }
        return json(res, 200, { role, preview: platform.previewChangeImpact(id, changeClass, sections) });
      }

      if (req.method === "GET" && singleMatch) {
        const projection = platform.getProposal(singleMatch[1]);
        const redacted = redactProjection(projection, { role });
        return json(res, 200, {
          role,
          proposal_id: projection.proposal_id,
          gates: Object.fromEntries([...projection.gates].map(([k, g]) => [k, {
            state: g.state, blockers: g.blockers, readiness: g.readiness, reopenedBy: g.reopenedBy,
          }])),
          release_ready: projection.releaseReady.ready,
          released_versions: projection.activeReleases.map((r) => r.payload.version_tag),
          drilldown: redacted.drilldown,
          events: redacted.ordered.map((e) => ({
            event_id: e.event_id, event_type: e.event_type, occurred_at: e.occurred_at,
            version: e.version, summary: e.summary, payload: e.payload,
          })),
        });
      }

      if (req.method === "POST" && url.pathname.match(/^\/proposals\/[^/]+\/interactions\/use$/)) {
        const id = url.pathname.split("/")[2];
        const body = await readJson(req);
        const result = platform.requestInteractionUse(id, body);
        return json(res, result.allowed ? 200 : 422, result);
      }

      return json(res, 404, { error: "未找到路由" });
    } catch (err) {
      return json(res, err.name === "ConstraintError" ? 422 : 500, {
        error: err.message,
        ...(err.details ? { details: err.details } : {}),
      });
    }
  });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => { data += c; });
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

function startCli() {
  const args = process.argv.slice(2);
  const fileArg = args.indexOf("--file");
  const portArg = args.indexOf("--port");
  const file = fileArg >= 0 ? args[fileArg + 1] : null;
  const port = Number(portArg >= 0 ? args[portArg + 1] : process.env.PORT ?? 8080);
  const platform = new Platform({ file });
  createApp(platform).listen(port, () => {
    console.log(`立项与变更平台已启动：http://localhost:${port}（事件存储：${file ?? "内存"}）`);
  });
}

import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startCli();
}

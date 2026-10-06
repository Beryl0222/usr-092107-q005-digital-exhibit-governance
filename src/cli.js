#!/usr/bin/env node
/**
 * 立项与变更平台命令行（零依赖）。
 *
 * 用法：
 *   node src/cli.js --file data/store.jsonl list
 *   node src/cli.js --file data/store.jsonl show <proposal_id> [--role reviewer]
 *   node src/cli.js --file data/store.jsonl drilldown <proposal_id>
 *   node src/cli.js --file data/store.jsonl change-preview <proposal_id> <change_class> [section,section]
 *   node src/cli.js --file data/store.jsonl events [proposal_id]
 *
 * 写操作建议走平台 API（src/platform.js）；CLI 侧重决策链查看与变更预判。
 */

import { Platform } from "./platform.js";
import { redactEvent } from "./redact.js";
import { GATE_ORDER, CHANGE_CLASS_LABELS } from "./contracts.js";

function parseArgs(argv) {
  const args = { _: [], role: "public", file: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--file") args.file = argv[++i];
    else if (a === "--role") args.role = argv[++i];
    else args._.push(a);
  }
  return args;
}

const GATE_ICON = {
  approved: "✅",
  conditional: "🟡",
  rejected: "❌",
  reopened_pending: "🔁",
  awaiting_review: "⬜",
  in_progress: "✏️ ",
  not_started: "· ",
};

function main() {
  const args = parseArgs(process.argv.slice(2));
  const [command, ...rest] = args._;
  const pf = new Platform({ file: args.file });

  switch (command) {
    case "list": {
      for (const p of pf.listProposals()) {
        console.log(`${p.release_ready ? "🟢" : "⚪"} ${p.proposal_id}  ${p.title ?? ""}`);
        console.log(`   ${GATE_ORDER.map((g) => `${GATE_ICON[p.gates[g]] ?? "·"}${g}`).join("  ")}`);
        if (p.released_versions.length) console.log(`   已上线：${p.released_versions.join(", ")}`);
      }
      break;
    }

    case "show": {
      const projection = pf.getProposal(rest[0]);
      console.log(`方案 ${projection.proposal_id}：${projection.thesis.current?.payload.title ?? ""}`);
      console.log("决策链门禁：");
      for (const gate of GATE_ORDER) {
        const g = projection.gates.get(gate);
        console.log(`  ${GATE_ICON[g.state] ?? "·"} ${gate.padEnd(12)} ${g.state}${g.reopenedBy.length ? `  重开自:${g.reopenedBy.join(",")}` : ""}`);
        for (const b of g.blockers) console.log(`        ⚠ ${b}`);
      }
      console.log(`\n上线就绪：${projection.releaseReady.ready ? "是" : "否"}`);
      if (proposalNotReady(projection)) {
        console.log("  未决：", projection.releaseReady.notApproved.map((n) => n.gate).join(", "));
      }
      break;
    }

    case "drilldown": {
      const [id] = rest;
      for (const proto of pf.drilldown(id)) {
        console.log(`原型 ${proto.prototype_id}（演示 ${proto.demo_ref}）`);
        for (const c of proto.claims) {
          console.log(`  断言 ${c.claim_id}${c.historical ? " [史实]" : " [体验]"}：${c.statement}`);
          for (const ev of c.evidence) {
            const reg = ev.registered;
            console.log(`      └ ${ev.ref} ${reg ? `[${reg.kind}] ${reg.title} 指纹${ev.registered.hash_match === null ? "未比对" : ev.registered.hash_match ? "一致" : "不一致"}` : "（素材未登记！）"}`);
            if (ev.clearance) console.log(`           许可：${ev.clearance.license_scope}｜AI=${ev.clearance.ai_generated}｜人工复核=${ev.clearance.human_reviewed}`);
            for (const r of ev.academic_reviews) console.log(`           学术审读：${r.verdict}（${r.reviewer_expertise}）${r.notes ? " " + r.notes : ""}`);
          }
        }
      }
      break;
    }

    case "change-preview": {
      const [id, changeClass, sectionsCsv] = rest;
      if (!CHANGE_CLASS_LABELS[changeClass]) {
        console.error(`非法变更类别：${changeClass}`);
        console.error(`可选：${Object.keys(CHANGE_CLASS_LABELS).join(", ")}`);
        process.exit(1);
      }
      const sections = (sectionsCsv ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      const preview = pf.previewChangeImpact(id, changeClass, sections);
      console.log(`变更「${preview.label}」${preview.reapproval_needed ? "需要重新审批" : "无需重新审批"}`);
      console.log(`重开门禁：${preview.reopened_gates.join(", ") || "（无）"}`);
      if (preview.requires_special.length) console.log(`触发特殊核对：${preview.requires_special.join(", ")}`);
      console.log(`显式沿用的学术意见：${preview.carried_reviews.length} 条（不悬空）`);
      for (const c of preview.carried_reviews) console.log(`   └ ${c.review_event_id}：${c.note}`);
      break;
    }

    case "events": {
      const [id] = rest;
      const events = id ? pf.store.streamForProposal(id) : pf.store.all();
      for (const e of events) {
        const shown = redactEvent(e, { role: args.role });
        console.log(`${shown.occurred_at} v${shown.version} ${shown.aggregate_type}/${shown.aggregate_id} ${shown.event_type} — ${shown.summary}`);
      }
      break;
    }

    default:
      console.log("命令：list | show <id> | drilldown <id> | change-preview <id> <change_class> [sections] | events [id]");
      console.log(`变更类别：${Object.keys(CHANGE_CLASS_LABELS).join(", ")}`);
      process.exit(command ? 1 : 0);
  }
}

function proposalNotReady(projection) {
  return !projection.releaseReady.ready;
}

main();

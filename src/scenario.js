/**
 * 端到端联调场景：在给定平台上走通一条完整决策链，供演示脚本与测试共用。
 * 场景围绕"北京中轴线·晨钟暮鼓"数字展项，另建一对高度雷同的方案触发提示。
 */
import { GateError } from "./app.js";

const APPLICANT = { id: "u-guohang", role: "applicant", display_name: "郭航", org: "中轴数字展陈中心" };
const REVIEWER = { id: "u-chenyan", role: "reviewer", display_name: "陈言", org: "北京市考古研究院" };
const A11Y_ORG = "无障碍体验测评中心";
const BOARD = { id: "board-office", role: "board", display_name: "市级文化项目办公室" };

/**
 * @param {import('./app.js').GovernancePlatform} pf
 * @param {object} [opts]
 * @param {boolean} [opts.full] 为 true 时补齐全部门禁材料直到上线（默认 true）。
 */
export function buildScenario(pf, { full = true } = {}) {
  const out = {};

  // 1) 策展命题：独有的文化命题是立项第一对象。
  out.thesis = pf.submitThesis({
    thesis_id: "thesis-zhonglou",
    title: "晨钟暮鼓：中轴线的时间秩序",
    cultural_claim: "钟楼与鼓楼并非两座孤立建筑，而是一套从元大都到清末持续校准全城作息的'时间制度'；数字展项要复原的是声音与城市场景共同构成的秩序，而非建筑外观。",
    research_questions: ["钟鼓声的实际声响是否可由测音资料复原？", "不同朝代报时仪式的空间动线如何变化？"],
    keywords: ["中轴线", "钟楼", "鼓楼", "报时制度", "声音景观"],
    submitter_id: "u-guohang",
    actor: APPLICANT,
  });

  // 另一组命题，与主案表述接近（用于演示雷同提示——只提示，不判定）。
  pf.submitThesis({
    thesis_id: "thesis-zhonglou-copy",
    title: "晨钟暮鼓：中轴线上的时间秩序",
    cultural_claim: "钟楼鼓楼并非两座孤立建筑，而是一套从元大都到清末持续校准全城作息的时间制度；展项复原声音与城市场景共同构成的秩序。",
    keywords: ["中轴线", "钟楼", "鼓楼", "报时制度"],
    actor: APPLICANT,
  });

  // 2) 立项：申报现场、海外巡展、原址叠加、AI 复原四种使用范围。
  out.proposal = pf.createProposal({
    proposal_id: "proposal-bell-drum",
    thesis_id: "thesis-zhonglou",
    title: "晨钟暮鼓数字展项",
    channels: ["onsite", "overseas_tour", "on_site_overlay", "ai_generated"],
    venues: ["CN-BJ", "FR-PAR", "GB-LON"],
    lead_org: "org-zaxis-center",
    actor: APPLICANT,
  });

  out.proposalCopy = pf.createProposal({
    proposal_id: "proposal-bell-drum-twin",
    thesis_id: "thesis-zhonglou-copy",
    title: "钟鼓声景数字展项",
    channels: ["onsite"],
    venues: ["CN-BJ"],
    lead_org: "另一家展陈机构",
    actor: APPLICANT,
  });

  // 3) 研究素材：考古测绘、建筑图档、声音采集各一。
  pf.registerAsset({
    asset_id: "asset-survey-1986",
    kind: "archaeological_survey",
    title: "1986 年钟楼基座发掘实测图",
    citation: "北京市考古研究院：《钟楼基座发掘测绘报告（1986）》图版 12–18",
    holding_institution: "北京市考古研究院",
    custodian_contact: "档案部 王老师 010-0000-0000",
    provenance_note: "配合 1986 年钟楼修缮工程的抢救性发掘资料",
    actor: APPLICANT,
  });
  pf.registerAsset({
    asset_id: "asset-archive-qianlong",
    kind: "architectural_archive",
    title: "乾隆《京城全图》钟鼓楼层段",
    citation: "清乾隆十五年《乾隆京城全图》排页 07，中国第一历史档案馆藏仿真复制件",
    holding_institution: "中国第一历史档案馆",
    provenance_note: "已获仿真复制件研究使用授权",
    actor: APPLICANT,
  });
  pf.registerAsset({
    asset_id: "asset-sound-2024",
    kind: "sound_recording",
    title: "2024 年大钟测音与古钟声学比对采样",
    citation: "中国音乐学院声学实验室：《永乐大钟与钟楼古钟测音报告（2024）》采样轨 B03–B11",
    holding_institution: "中国音乐学院声学实验室",
    custodian_contact: "声学实验室 李老师",
    actor: APPLICANT,
  });

  // 许可：分别记录覆盖的渠道与地域。声音素材仅授权现场与国内线上，
  // 不覆盖海外巡展与 AI 训练式生成——场景中随后补一条扩展许可。
  pf.clearSource({
    asset_id: "asset-survey-1986", proposal_id: "proposal-bell-drum",
    scope: { channels: ["onsite", "overseas_tour", "on_site_overlay", "online", "ai_generated"], territories: ["CN", "FR", "GB"] },
    cleared: true, license_document_ref: "LIC-2026-031",
    actor: REVIEWER,
  });
  pf.clearSource({
    asset_id: "asset-archive-qianlong", proposal_id: "proposal-bell-drum",
    scope: { channels: ["onsite", "overseas_tour", "on_site_overlay"], territories: ["CN", "FR", "GB"] },
    cleared: true, license_document_ref: "LIC-2026-032",
    actor: REVIEWER,
  });
  pf.clearSource({
    asset_id: "asset-sound-2024", proposal_id: "proposal-bell-drum",
    scope: { channels: ["onsite", "overseas_tour", "on_site_overlay", "ai_generated"], territories: ["CN", "FR", "GB"], restrictions: ["AI 仅限音色复原，不得生成旋律"] },
    cleared: true, license_document_ref: "LIC-2026-033",
    actor: REVIEWER,
  });

  // 对照方案也登记原型材料（雷同提示需要可比文本）。
  pf.submitPrototype({
    proposal_id: "proposal-bell-drum-twin",
    prototype_version: 1,
    demo_scenes: [{
      scene_id: "s-time",
      title: "时间制度",
      claim: "钟楼鼓楼并非两座孤立建筑，而是一套从元大都到清末持续校准全城作息的时间制度，复原声音与城市场景共同构成的秩序。",
      asset_citations: [{ asset_id: "asset-survey-1986", locator: "图版 12", usage: "基座尺度参照" }],
    }],
    actor: APPLICANT,
  });

  // 4) 交互原型：每个演示片段都逐处引用素材；AI 辅助片段显式标注。
  out.prototype = pf.submitPrototype({
    proposal_id: "proposal-bell-drum",
    prototype_version: 1,
    artifact_ref: "proto://bell-drum/v1",
    demo_scenes: [
      {
        scene_id: "s-ruins",
        title: "地下的钟：1986 基座发掘",
        claim: "今钟楼本体之下保留有元代钟楼基础，实测错位 1.7 米，说明现存建筑是在旧址上重建。",
        asset_citations: [
          { asset_id: "asset-survey-1986", locator: "图版 14 剖面 B-B", usage: "基础边线与错位量", interpretation: "元代基础与明代台基错位 1.7 米", certainty: "measured" },
        ],
      },
      {
        scene_id: "s-map",
        title: "图上的更点：乾隆京城全图",
        claim: "乾隆图中鼓楼前广场为商铺与汛坊围合，报时声覆盖的是商业与治安混合空间。",
        asset_citations: [
          { asset_id: "asset-archive-qianlong", locator: "排页 07 局部", usage: "广场围合关系", certainty: "documented" },
          { asset_id: "asset-survey-1986", locator: "图版 12 总平面", usage: "与现代地形套合", certainty: "measured" },
        ],
      },
      {
        scene_id: "s-sound",
        title: "听得见的更点：古钟音色复原",
        claim: "依据测音报告主频与泛音结构复原的钟声用于现场与原址叠加；AI 仅复原音色，不生成旋律，且须逐段人工核实。",
        asset_citations: [
          { asset_id: "asset-sound-2024", locator: "采样轨 B07", usage: "主频 56Hz 与泛音包络", certainty: "measured" },
        ],
        ai_assisted: true,
      },
    ],
    actor: APPLICANT,
  });

  // 原型提交后系统已自动产生雷同提示（仅提示）。
  out.similarityReportId = out.prototype.similarity.report?.aggregate_id ?? null;

  // 5) 组件：一个成熟复用组件（必须披露来源与修改）+ 一个新研组件。
  pf.declareComponent({
    component_id: "comp-dome-screen",
    proposal_id: "proposal-bell-drum",
    name: "穹幕融合播放套件 v4",
    supplier_id: "supplier-huaying",
    is_reuse: true,
    origin: { source_type: "mature_product", upstream_name: "华影穹幕融合套件", upstream_version: "4.2", license: "商业授权 HS-2025-119" },
    modifications: "增加双机热备与中文大字幕后台；未改动融合算法核心。",
    qualification_evidence_ref: "qual/dome-4.2.pdf",
    actor: APPLICANT,
  });
  pf.declareComponent({
    component_id: "comp-timbre-engine",
    proposal_id: "proposal-bell-drum",
    name: "古钟音色合成引擎",
    supplier_id: "supplier-huaying",
    is_reuse: false,
    origin: { source_type: "market_new" },
    actor: APPLICANT,
  });

  // 6) 预算里程碑。
  pf.setBudget({
    proposal_id: "proposal-bell-drum",
    currency: "CNY", total_amount: 4200000,
    milestones: [
      { milestone_id: "m1", name: "立项与详设", amount: 800000, due_date: "2026-12-31", deliverable: "详设与原型 v1", stage_gate: "acceptance" },
      { milestone_id: "m2", name: "集成联调", amount: 1900000, due_date: "2027-04-30", deliverable: "现场集成完成", stage_gate: "pre_release" },
      { milestone_id: "m3", name: "试运行上线", amount: 1500000, due_date: "2027-06-30", deliverable: "上线版本", stage_gate: "go_live" },
    ],
    actor: APPLICANT,
  });

  // 7) 无障碍评估（覆盖全部片段；声音片段附条件：须有视觉替代）。
  pf.reviewAccessibility({
    review_id: "a11y-001",
    proposal_id: "proposal-bell-drum", standard: "GB/T 无障碍设计相关条款 + 现场实测",
    result: "conditional",
    scope_sections: ["s-ruins", "s-map", "s-sound"],
    findings: [{ area: "声音信息无障碍", severity: "medium", finding: "s-sound 的音色演示缺少等效视觉提示" }],
    conditions: ["上线前为 s-sound 增加字幕与振动节奏可视化"],
    reviewer_org: A11Y_ORG,
    actor: { id: "u-a11y", role: "reviewer", org: A11Y_ORG },
  });

  // 8) 学术审读：逐片段给结论；测绘段有条件认可。
  pf.recordScholarReview({
    review_id: "review-arch-001",
    proposal_id: "proposal-bell-drum",
    verdict: "endorse",
    opinion: "1986 年测绘图版 14 的错位量引用准确；结论限定为'旧址重建'稳妥。",
    scope_sections: ["s-ruins", "s-map"],
    reviewed_prototype_version: 1,
    reviewer_id: "u-chenyan", reviewer_display_name: "陈言", reviewer_org: "北京市考古研究院",
    actor: REVIEWER,
  });
  pf.recordScholarReview({
    review_id: "review-sound-001",
    proposal_id: "proposal-bell-drum",
    verdict: "endorse",
    opinion: "测音主频引用无误；AI 仅用于音色复原、旋律与仪式解说仍由人工撰写，符合学术审读要求。",
    scope_sections: ["s-sound"],
    reviewed_prototype_version: 1,
    reviewer_id: "u-linqi", reviewer_display_name: "林七", reviewer_org: "中国音乐学院",
    actor: { id: "u-linqi", role: "reviewer", display_name: "林七", org: "中国音乐学院" },
  });

  // 9) 渠道使用范围分别核对。
  pf.checkChannel({
    proposal_id: "proposal-bell-drum", channel: "onsite", status: "cleared",
    scope: { territories: ["CN"] }, actor: REVIEWER,
  });
  pf.checkChannel({
    proposal_id: "proposal-bell-drum", channel: "overseas_tour", status: "cleared",
    scope: { territories: ["FR", "GB"], purposes: ["文化交流展"], expires_at: "2028-12-31" },
    human_reviewed: true, human_reviewer_id: "u-chenyan",
    review_note: "巡展仅使用仿真复制图档与测音数据，不含原件出境。",
    actor: BOARD,
  });
  pf.checkChannel({
    proposal_id: "proposal-bell-drum", channel: "on_site_overlay", status: "pending_human_review",
    scope: { territories: ["CN"], restrictions: ["叠加层须与现存基址保持 0.5 米可视间距标识"] },
    review_note: "等待文物处现场复核", actor: REVIEWER,
  });

  if (full) completeReviewAndRelease(pf, out);

  return out;
}

/**
 * 补齐 full=false 场景之后的放行步骤：
 * 原址叠加现场复核、AI 人工核实、雷同人工裁定、三阶段批准与 v1.0.0 上线。
 */
export function completeReviewAndRelease(pf, out) {
  pf.checkChannel({
    proposal_id: "proposal-bell-drum", channel: "on_site_overlay", status: "cleared",
    scope: { territories: ["CN"], restrictions: ["叠加层须与现存基址保持 0.5 米可视间距标识"] },
    human_reviewed: true, human_reviewer_id: "u-chenyan",
    review_note: "现场复核：标识方案可行。", actor: REVIEWER,
  });
  pf.checkChannel({
    proposal_id: "proposal-bell-drum", channel: "ai_generated", status: "cleared",
    scope: { purposes: ["音色复原"], restrictions: ["不得生成旋律", "不得生成人物对话"] },
    human_reviewed: true, human_reviewer_id: "u-linqi",
    ai_output_disclosure: {
      model_source: "自研声学模型 timbre-engine v0.9",
      training_data_note: "仅使用已获授权的 asset-sound-2024 采样，不含观众语音",
      human_verified_sections: ["s-sound"],
    },
    actor: REVIEWER,
  });

  pf.adjudicateSimilarity({
    report_id: out.similarityReportId,
    disposition: "distinct",
    rationale: "命题用语接近，但本方案独有测音复原路径与原址叠加证据链，对照方案不具备；不构成抄袭。",
    adjudicator_id: "u-chenyan",
    actor: REVIEWER,
  });

  pf.approveStage({ proposal_id: "proposal-bell-drum", stage: "acceptance", decision: "approved", board_id: "board-2026-q4", actor: BOARD });
  pf.approveStage({ proposal_id: "proposal-bell-drum", stage: "pre_release", decision: "approved", board_id: "board-2027-q2", actor: BOARD });
  pf.approveStage({ proposal_id: "proposal-bell-drum", stage: "go_live", decision: "approved", board_id: "board-2027-q2", actor: BOARD });

  out.release = pf.releaseVersion({
    proposal_id: "proposal-bell-drum",
    release_id: "rel-1-0-0", version: "1.0.0",
    artifact_ref: "release://bell-drum/1.0.0",
    prototype_version: 1,
    release_notes: "首版上线：含基座发掘、乾隆图档、音色复原三个演示片段。",
    approver_id: "board-office",
    actor: BOARD,
  });
  return out;
}

/**
 * 在已上线的方案上演示"设备替换 + 延期"局部变更：
 * 只重审组件与排期；两条学术意见与无障碍评估全部显式承继，不悬空。
 */
export function buildEquipmentChange(pf) {
  const change = pf.requestChange({
    proposal_id: "proposal-bell-drum",
    change_id: "change-projector-swap",
    change_kind: "equipment_replacement",
    affected_sections: [
      { section_type: "component", ref: "comp-dome-screen", summary: "投影主机 A 型停产，以同亮度 B 型替换，融合算法与播放内容不变" },
    ],
    justification: "供应商通知 A 型停产，B 型指标等同；工期顺延 3 周。",
    requested_by: "u-guohang",
    actor: { id: "u-guohang", role: "applicant" },
  });

  // 设备替换只重审组件；学术、无障碍、渠道意见全部承继。延期只进排期。
  pf.reviewChange({
    change_id: "change-projector-swap",
    decision: "approved",
    rereview_scope: ["component", "schedule"],
    carried_review_ids: ["review-arch-001", "review-sound-001", "a11y-001"],
    note: "替换设备指标等同，内容与呈现证据链不变；既有学术与无障碍意见继续有效。延期 3 周记入排期。",
    reviewer_id: "board-office",
    actor: BOARD,
  });

  // 补齐重审材料：新组件重新披露（设备替换）。
  pf.declareComponent({
    component_id: "comp-projector-b",
    proposal_id: "proposal-bell-drum",
    name: "B 型 4K 投影主机",
    supplier_id: "supplier-huaying",
    is_reuse: true,
    origin: { source_type: "mature_product", upstream_name: "华影 B 型激光投影", upstream_version: "B-2027", license: "采购合同 HS-2027-006" },
    modifications: "未修改，整机替换；亮度、色温与 A 型等同的检测报告附后。",
    qualification_evidence_ref: "qual/projector-b-2027.pdf",
    actor: { id: "u-guohang", role: "applicant" },
  });

  return change;
}

/**
 * 演示内容变更：触发原型 + 学术内容重审，原学术意见显式失效、重审后登记新意见；
 * 无障碍意见因片段不变而承继。
 */
export function buildContentChange(pf) {
  pf.requestChange({
    proposal_id: "proposal-bell-drum",
    change_id: "change-ritual-rewrite",
    change_kind: "content_revision",
    affected_sections: [
      { section_type: "prototype", ref: "s-sound", summary: "补入清代报时仪式动线的新考证，重写 s-sound 解说" },
      { section_type: "scholarly_content", ref: "s-sound", summary: "解说中的仪式时序改写" },
    ],
    justification: "新发现宣统元年巡警总厂档案，需修正仪式时序表述。",
    requested_by: "u-guohang",
    actor: { id: "u-guohang", role: "applicant" },
  });

  pf.reviewChange({
    change_id: "change-ritual-rewrite",
    decision: "approved_with_conditions",
    rereview_scope: ["prototype", "scholarly_content"],
    carried_review_ids: ["review-arch-001", "a11y-001"],
    invalidated_review_ids: ["review-sound-001"],
    conditions: ["新档案须登记为研究素材并在 s-sound 重新标注出处"],
    note: "仅声音段解说改写；测绘学术意见与无障碍评估继续有效。",
    reviewer_id: "board-office",
    actor: BOARD,
  });

  pf.registerAsset({
    asset_id: "asset-archive-1909",
    kind: "field_notes",
    title: "宣统元年巡警总厂报时值守记录",
    citation: "北京市档案馆：《巡警总厂勤务纪要（1909）》节录",
    holding_institution: "北京市档案馆",
    provenance_note: "新考证依据，限研究与展示使用",
    actor: { id: "u-guohang", role: "applicant" },
  });
  pf.clearSource({
    asset_id: "asset-archive-1909", proposal_id: "proposal-bell-drum",
    scope: { channels: ["onsite", "overseas_tour", "on_site_overlay", "ai_generated"], territories: ["CN", "FR", "GB"] },
    cleared: true, license_document_ref: "LIC-2027-104",
    actor: REVIEWER,
  });

  // 重提原型 v2（只改 s-sound，其他片段不变）。
  pf.submitPrototype({
    proposal_id: "proposal-bell-drum",
    prototype_version: 2,
    artifact_ref: "proto://bell-drum/v2",
    demo_scenes: [
      {
        scene_id: "s-ruins", title: "地下的钟：1986 基座发掘",
        claim: "今钟楼本体之下保留有元代钟楼基础，实测错位 1.7 米，说明现存建筑是在旧址上重建。",
        asset_citations: [{ asset_id: "asset-survey-1986", locator: "图版 14 剖面 B-B", usage: "基础边线与错位量", certainty: "measured" }],
      },
      {
        scene_id: "s-map", title: "图上的更点：乾隆京城全图",
        claim: "乾隆图中鼓楼前广场为商铺与汛坊围合，报时声覆盖的是商业与治安混合空间。",
        asset_citations: [
          { asset_id: "asset-archive-qianlong", locator: "排页 07 局部", usage: "广场围合关系", certainty: "documented" },
          { asset_id: "asset-survey-1986", locator: "图版 12 总平面", usage: "与现代地形套合", certainty: "measured" },
        ],
      },
      {
        scene_id: "s-sound", title: "听得见的更点：古钟音色复原",
        claim: "宣统元年值守记录显示定更击鼓三通后撞钟一百零八响；据此修正仪式时序，音色仍依据测音报告复原，AI 仅复原音色。",
        asset_citations: [
          { asset_id: "asset-sound-2024", locator: "采样轨 B07", usage: "主频 56Hz 与泛音包络", certainty: "measured" },
          { asset_id: "asset-archive-1909", locator: "勤务纪要节录第 3 页", usage: "击鼓与撞响次序", certainty: "documented" },
        ],
        ai_assisted: true,
      },
    ],
    actor: { id: "u-guohang", role: "applicant" },
  });

  // 重审后的新学术意见。
  pf.recordScholarReview({
    review_id: "review-sound-002",
    proposal_id: "proposal-bell-drum",
    verdict: "endorse",
    opinion: "1909 年值守记录引用准确，'三通鼓后一百零八响'表述与档案一致；音色复原路径维持原结论。",
    scope_sections: ["s-sound"],
    reviewed_prototype_version: 2,
    reviewer_id: "u-linqi", reviewer_display_name: "林七", reviewer_org: "中国音乐学院",
    actor: { id: "u-linqi", role: "reviewer", display_name: "林七", org: "中国音乐学院" },
  });
}

export { APPLICANT, REVIEWER, BOARD, A11Y_ORG, GateError };

# 数字文化展项立项与变更平台

市级文化项目办公室评审中轴线数字展项时，首要问题不是采购哪种投影或 VR 设备，而是**每个方案是否先提出了独有的文化命题**，并能把体验演示逐处追溯到考古测绘、建筑图档、声音采集和学术审读。

平台把以下环节放在同一条只追加事件链（decision chain）上：

> 策展命题 → 研究素材登记与许可 → 交互原型（逐处出处）→ 供应商组件（复用披露）→ 预算里程碑 → 无障碍评估 / 学术审读 → 海外巡展 / 原址叠加 / AI 内容使用范围核对 → 阶段批准 → 变更请求与局部重审 → 上线版本 → 开放后的匿名互动

零外部依赖，纯 Node 22 实现。`node src/demo.js` 可看到一条完整中文决策链。

## 仓库布局

| 路径 | 职责 |
| --- | --- |
| `contracts/domain.schema.json` | 领域事件信封、聚合目录、19 类事件的 payload 契约（JSON Schema 2020-12） |
| `src/domain.ts` | 同一份契约的 TypeScript 类型，Node 直接类型擦除导入 |
| `src/validator.js` | 信封 + 各事件 payload 的运行时校验，中文错误信息 |
| `src/store.js` | 只追加 JSONL 事件存储：版本连续、乐观并发、篡改即拒、更正留痕 |
| `src/projections.js` | 从事件流重建方案读模型；意见在历次变更中的存活/失效/悬空计算 |
| `src/change-scope.js` | 变更影响的片段级判定（设备替换不波及其他片段的学术意见） |
| `src/policies.js` | 门禁评估、变更影响矩阵、意见承继规则、专项渠道规则、发布条件 |
| `src/similarity.js` | 方案雷同提示（Jaccard + 中文二元组），**只提示、不判定抄袭** |
| `src/app.js` | 应用服务：19 个命令，所有写操作唯一落点是事件存储 |
| `src/views.js` | 评审下钻视图、公众开放视图、角色脱敏 |
| `src/server.js` | 零依赖 HTTP API（NDJSON 事件链 + JSON 命令/查询） |
| `src/scenario.js` | 端到端联调场景（晨钟暮鼓数字展项），演示与测试共用 |
| `src/demo.js` | `node src/demo.js` 中文端到端演示 |
| `tests/` | 58 个测试：契约一致性、存储、门禁矩阵、变更承继、雷同边界、脱敏、HTTP |
| `data/sample.json` | 一条符合契约的中文样例事件（策展命题） |

## 核心规则

### 1. 立项门禁：命题先行，演示可下钻到数据出处

阶段批准（`STAGE_APPROVED`：立项受理 → 上线前评审 → 放行上线）前，`evaluateProposal` 逐项核对：

1. **独有的文化命题**（`THESIS_SUBMITTED.cultural_claim`）——撤回的命题不能用于新方案；
2. **交互原型**的每个演示片段写明 `claim`（论证），且至少一处 `asset_citations`，逐条给出素材 id、定位（图版/轨号）、用途与确定性（实测 `measured` / 文献 `documented` / 推断 `inferred`）；
3. **素材许可**覆盖该片段在每个实际呈现渠道的使用范围（渠道、地域、用途、到期时间）；引用未登记素材、许可不覆盖渠道、许可过期均阻断；
4. **复用组件**必须披露 `origin`（成熟产品 / 内部既有 / 开源 / 新研）与 `modifications`（未修改也须显式写"未修改"）；
5. **预算里程碑**金额合计须与总额一致；
6. **无障碍评估**覆盖每个当前片段，`fail` 阻断，`conditional` 以条件形式提示；
7. **学术审读**覆盖每个片段的论证：`reject`/`revise` 阻断；同一片段有多条意见时以**最新一条**为准（重做后登记的新意见解除旧否定）；
8. **渠道专项**（见下）；
9. 未结案的**雷同提示**阻断上会——阻断的原因是"尚未人工裁定"，**不是**相似度分数；
10. 已批准变更要求的重审材料必须补齐（变更闭环）。

评审人员从任意演示片段下钻，即可看到：命题 → 片段论证 → 素材文献引注与许可文书编号 → 覆盖该片段的学术意见与无障碍结论 → 渠道核对（含人工复核留痕）。

### 2. 海外巡展、原址叠加、AI 内容分别核对

三类渠道是独立的 `CHANNEL_SCOPE_CHECKED` 记录，互不替代：

- **海外巡展 `overseas_tour`**：必须列明授权国家/地区；门禁只校验境外场馆（本土场馆归 onsite），超出授权地域即阻断；
- **原址叠加 `on_site_overlay`** 与 **AI 生成内容 `ai_generated`**：服务层不允许"系统自动放行"——只能先登记 `pending_human_review`，由具备评审职责的人员登记 `cleared` + `human_reviewed`；
- AI 渠道还要求披露模型来源、训练数据说明，并对每个标注 `ai_assisted` 的片段留**逐段人工核实**记录；素材许可中 AI 渠道只核对 AI 辅助片段，不扩大解释。

### 3. 变更：只重审受影响部分，原有学术意见不悬空

`CHANGE_REQUESTED.change_kind` 与申报方列明的受影响部分共同决定**最小重审范围**（`requiredRereviewScope`）：

| 变更种类 | 至少重审 |
| --- | --- |
| `equipment_replacement` 设备替换 | `component`（申报方可附带 `schedule` 延期） |
| `schedule_delay` 纯延期 | `schedule` |
| `content_revision` 内容修订 | `prototype` + `scholarly_content` |
| `venue_change` 场馆变更 | `venue`（原址叠加方案另加 `channel_scope`） |
| `overseas_extension` 海外扩展 | `channel_scope` + `venue` |
| `ai_scope_extension` AI 范围扩展 | `channel_scope` + `scholarly_content` |
| `budget_adjustment` 预算调整 | `budget` |

影响判定到**片段级**（`src/change-scope.js`）：只改写 `s-sound` 解说时，覆盖 `s-ruins/s-map` 的考古学术意见不会被波及。

`CHANGE_REVIEWED` 必须对每条既有学术/无障碍意见显式二选一：

- 受影响片段 → `invalidated_review_ids`（失效），重审后登记**新意见**，不能原样承继；
- 不受影响 → `carried_review_ids`（明示继续有效）。

既不承继也不失效的意见即"悬空"，审批事件本身会被拒绝（`validateChangeDecision`）。重审材料补齐前，变更不闭环、门禁不放行。

**任何已审批变更之后发布新版本，都必须由办公室重新确认一次 `go_live`**——只换一台设备或延期三周也不例外；项目组因此明确知道哪种变更要重新审批。

### 4. 雷同提示 ≠ 抄袭判定

- 原型提交时系统自动比对命题与演示论证（不碰版权、预算等商业字段），超过阈值只追加 `SIMILARITY_FLAGGED`，其 `advisory_only` 在契约层**恒为 true**，校验器拒绝任何 `false`；
- 系统输出分数与逐段匹配供参考，但全代码库没有任何"分数 → 抄袭"的映射；
- 是否成立只能由人工 `SIMILARITY_ADJUDICATED`（各自独立 / 需修改 / 升级抄袭关切复核）；裁定不可改写，有异议追加新报告；
- 未裁定或被裁定需修改/升级的方案不能上会放行。

### 5. 开放后的匿名互动只能改进体验

- `VISITOR_SIGNAL_RECORDED` 由服务端强制写入 `permitted_use: "experience_improvement"` 与 `anonymous: true`，契约层拒绝其他取值；
- 信号以聚合统计呈现（停留、评分、路径），门禁证据对象恒定带 `signal_used_as_evidence: false`——信号没有任何通往论证、素材或历史事实的代码路径；
- 公众开放视图（`publicReleaseView`）只呈现经学术审读的素材引注，页面声明"匿名互动不作为历史事实或学术证据"。

### 6. 不可变记录与后继更正

- 事件一经接收，`event_id / occurred_at / version` 与内容不得原地改写；版本号由存储按聚合分配、严格 +1，外部提交的版本号不符即拒；
- JSONL 重放时遇重复 id、版本跳号/缺行立即失败（防篡改）；
- 更正只能追加 `CORRECTION_RECORDED`，以 `predecessor_event_id` 指向原事件，原记录原样保留。

## 角色与可见范围

个人、机构及商业敏感信息仅向履行职责所需的调用方开放：

| 信息 | board 办公室 | reviewer 评审 | applicant 本机构 | applicant 他机构 | public 公众 |
| --- | --- | --- | --- | --- | --- |
| 命题、论证、素材引注 | ✅ | ✅ | ✅ | ✅ | 仅已上线版本 |
| 许可文书编号、范围 | ✅ | ✅ | ✅ | ✅ | ❌ |
| 馆藏联系人 | ✅ | ❌ | ❌ | ❌ | ❌ |
| 评审人姓名/单位 | ✅ | ✅ | ❌ | ❌ | ❌ |
| 预算金额 | ✅ | ❌ | ✅（限 lead_org 相符） | ❌（只见里程碑节奏） | ❌ |
| 供应商、资质证据 | ✅ | ❌ | ✅ 限本机构 | ❌ | ❌ |
| 雷同裁定理由 | ✅ | ✅ | ✅ | ✅ | ❌（只见提示事实） |
| 门禁阻断项 | ✅ | ✅ | ✅ | ✅ | ❌ |

## HTTP API

```bash
PORT=8080 EVENT_LOG=data/eventlog.jsonl node src/server.js
```

身份用请求头声明（演示环境）：`X-Role: board|reviewer|applicant|public`、`X-User`、`X-Org`（机构代码，Latin-1）。服务端以身份头裁定 actor，**忽略请求体伪造的 actor**；命令级权限在服务端强制执行。

```bash
# 申报方提交命题（命令名即 src/app.js 方法名）
curl -s -X POST localhost:8080/events/commands/submitThesis \
  -H 'X-Role: applicant' -H 'X-User: u-guohang' -H 'X-Org: org-zaxis-center' \
  -H 'content-type: application/json' \
  -d '{"thesis_id":"t1","title":"晨钟暮鼓","cultural_claim":"钟鼓楼是一套时间制度……"}'

# 评审人员从演示下钻到论证与出处（金额、联系人按角色隐藏）
curl -s localhost:8080/proposals/proposal-bell-drum/trace -H 'X-Role: reviewer'

# 办公室看门禁阻断项/提示
curl -s localhost:8080/proposals/proposal-bell-drum/gate -H 'X-Role: board'

# 公众开放视图与不可变事件链（NDJSON，按角色脱敏）
curl -s localhost:8080/releases/rel-1-0-0/public
curl -s localhost:8080/events
```

| 方法与路径 | 说明 |
| --- | --- |
| `POST /events/commands/:name` | 执行 19 个命令之一（422 校验失败 / 409 门禁或冲突 / 403 越权） |
| `GET /proposals/:id/trace` | 评审下钻视图（演示片段 → 论证 → 出处 → 意见 → 渠道） |
| `GET /proposals/:id/gate` | 门禁报告（blockers / advisories），public 不可见 |
| `GET /releases/:id/public` | 公众开放视图 |
| `GET /releases/:id/signals` | 匿名互动聚合（仅改进体验） |
| `GET /events?aggregate_id=` | NDJSON 事件链，按角色脱敏 |
| `GET /health` | 健康检查 |

## 事件目录（19 类）

| 事件 | 聚合 | 要点 |
| --- | --- | --- |
| `THESIS_SUBMITTED` / `THESIS_WITHDRAWN` | `curatorial_thesis` | 独有的文化命题是立项第一对象 |
| `PROPOSAL_CREATED` | `experience_proposal` | 申报渠道与场馆 |
| `ASSET_REGISTERED` / `SOURCE_CLEARED` | `research_asset` | 考古测绘/建筑图档/声音采集；许可范围 |
| `PROTOTYPE_SUBMITTED` | `prototype` | 版本不可覆盖；片段必带出处 |
| `COMPONENT_DECLARED` | `supplier_component` | 复用必披露来源与修改 |
| `BUDGET_MILESTONE_SET` | `budget` | 里程碑金额合计 = 总额 |
| `ACCESSIBILITY_REVIEWED` | `accessibility_review` | 标明覆盖片段 |
| `SCHOLAR_REVIEW_RECORDED` | `scholarly_review` | endorse/revise/reject + 覆盖片段 |
| `CHANNEL_SCOPE_CHECKED` | `channel_clearance` | 海外/原址/AI 各自独立，后两者必留人工复核 |
| `SIMILARITY_FLAGGED` / `SIMILARITY_ADJUDICATED` | `similarity_report` | advisory_only 恒 true；人来裁定 |
| `CHANGE_REQUESTED` / `CHANGE_REVIEWED` | `change_request` / `approval_decision` | 局部重审；意见承继/失效显式落位 |
| `STAGE_APPROVED` | `approval_decision` | 受理 → 上线前 → 放行；不可原地改写 |
| `VERSION_RELEASED` | `release` | 变更后须重新确认 go_live |
| `VISITOR_SIGNAL_RECORDED` | `visitor_signal` | 强制匿名；仅限体验改进 |
| `CORRECTION_RECORDED` | 与被更正事件同聚合 | 后继更正，原记录不动 |

## 本地检查

```bash
node --test      # 58 个测试
node src/demo.js # 端到端中文演示
```

当前资料覆盖策展命题、学术来源、组件复用、渠道使用范围、变更承继、上线与开放互动。记录一经接收，标识、发生时间与版本不得原地改写；更正使用新的后继记录。个人、机构及商业敏感信息仅向履行职责所需的调用方开放。

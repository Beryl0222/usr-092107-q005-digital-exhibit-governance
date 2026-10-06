# 中轴线数字展项立项与变更平台

市级文化项目办公室评审下一轮中轴线数字展项的统一决策链。平台把**策展命题、研究素材许可、交互原型、供应商组件、预算里程碑、无障碍评估与上线版本**放在同一条可追溯链上，回答的首要问题不是“采购哪种投影或 VR 设备”，而是：

> 每个方案是否**先提出了独有的文化命题**，并能把**体验演示追溯到考古测绘、建筑图档、声音采集和学术审读**。

系统只保存事实与人工结论的事件、按规则给出**提示与门禁**，不替代专家做学术判断。

---

## 1. 一条决策链（十个门禁）

每个方案沿同一序列推进，前序门禁未通过不得跳关：

| 顺序 | 门禁 | 通过前提（就绪检查） |
| --- | --- | --- |
| 1 | `thesis` 命题 | 提交了**非空、独有**的文化命题；纯设备采购式方案直接被拦 |
| 2 | `source` 素材 | 考古测绘 / 建筑图档 / 声音采集 / 学术资料逐项登记并有**使用许可**；海外、原址、AI 素材已**人工复核** |
| 3 | `academic` 学术 | 命题与素材/原型均有学术审读，且无未解决的否决意见 |
| 4 | `prototype` 原型 | 演示中每条史实断言的证据链都指向**已登记素材**且**内容指纹一致** |
| 5 | `components` 组件 | 成熟组件可复用，但已**披露来源**；有修改须**逐项披露** |
| 6 | `budget` 预算 | 预算与里程碑已设定 |
| 7 | `accessibility` 无障碍 | 按标准评估并通过（或整改后重评） |
| 8 | `similarity` 雷同 | 每条系统雷同**提示**都已由**人工裁定**（系统不判抄袭） |
| 9 | `special` 特殊核对 | 海外巡展 / 原址叠加 / AI 生成内容逐项核对**使用范围**并经人工 |
| 10 | `approval` 立项 | 前序门禁全部通过，评审会准予上线 |

全部通过后才能 `VERSION_RELEASED`，发布时固化每一关的结论快照。

### 评审人员从演示下钻到数据出处

原型（演示包）中的每条断言都可一路下钻：

```
演示断言 c1「鼓楼台基为明代遗存尺度」 [史实]
  └─ 素材 A1 [archaeological_survey] 钟鼓楼台基考古测绘图
       保管机构：市考古研究院      指纹：sha256:aaa1（与申报一致 ✓）
       许可：site_superposition   AI=false  人工复核=true
       学术审读：pass（考古测绘）“测绘图与实物一致”
```

演示所见即所核版本：证据 `content_hash` 与登记原件不符会直接阻塞原型门禁。

---

## 2. 关键治理规则（与需求一一对应）

- **先有命题，后谈设备**：`submitThesis` 拒绝空命题；命题是决策链第一关。
- **演示可溯源**：断言证据只能来自研究素材，且指纹对得上测绘/图档/采集原件（`policies/interaction.js#checkClaimProvenance`）。
- **成熟组件可复用，但须披露来源与修改**：复用缺来源披露、或有修改却不列 `modifications`，组件门禁不放行（修改未披露在存储层即被拒收）。
- **雷同只提示，不自动判抄袭**：`runSimilarityCheck` 仅产出候选与相似度信号（`SIMILARITY_FLAGGED`），必须由人工在雷同关用 `adjudicates_event_id` 裁定。系统永远不会输出“抄袭”结论。
- **海外巡展 / 原址叠加 / AI 生成内容**：分别核对使用范围（地区、场地、点位、期限、现场约束）与素材许可是否一致，并强制人工复核；AI 内容不得被核准为史实、须显著标注并设人工检查点（`policies/special-review.js`）。
- **设备替换、延期只触发受影响部分重审**：见下表；其余门禁结论保持有效。
- **学术意见不悬空**：任何变更批准时，系统自动把**未受影响的既有学术审读**逐条列入 `carried_reviews`（`applies:true`），显式沿用，不会因变更而丢失。
- **开放后的匿名互动只能改进体验**：互动记录强制匿名；请求把互动数据“写成史实/作为证据/再识别”一律拒绝，并追加 `INTERACTION_PURPOSE_VIOLATION_DETECTED` 留痕。互动数据永远不能进入史实断言证据链。

### 哪种变更必须重新审批

| 变更类别 | 重开门禁 | 特殊核对 |
| --- | --- | --- |
| `device_replacement` 设备替换 | 原型、无障碍（声明影响设备栈时含组件） | — |
| `schedule_delay` 延期 | 预算 | 许可到期检查 |
| `budget_adjustment` 预算调整 | 预算 | — |
| `component_swap` 组件替换 | 组件、原型、无障碍 | — |
| `venue_change` 场地变化 | 无障碍、特殊 | 海外巡展 / 原址叠加 |
| `content_change` 内容修改 | 命题、素材、学术、原型、雷同、特殊、立项 | AI 内容 |
| `aigc_addition` 新增 AI 内容 | 素材、学术、原型、特殊、立项 | AI 内容 |

项目组在**提交变更前**即可用 `previewChangeImpact`（CLI `change-preview` / HTTP `change-preview`）看到“要不要重审、重开哪几关、哪些学术意见会沿用”。

---

## 3. 事件与不可变性

所有结论以**只增事件**保存（基础事件约定在仓库既有契约上扩展）：

- 事件一经接收，`event_id`、`occurred_at`、`version` **不得原地改写**；存储不提供更新/删除接口。
- `event_id` 全局唯一；版本号在每个聚合实例内从 1 严格递增。
- 更正通过 `supersedes_event_id` **追加后继记录**，被更正记录原样保留。
- 持久化为 JSONL，崩溃后整表重放即可重建。

事件目录（21 类）与每类载荷定义见 [`contracts/domain.schema.json`](contracts/domain.schema.json)；类型见 [`src/domain.ts`](src/domain.ts)。载荷中的敏感字段用 `"x-classification"` 标注为 `personal` / `institutional` / `commercial`。

### 按角色脱敏

个人、机构与商业敏感信息仅向履行职责所需的调用方开放（`src/redact.js`）：

| 角色 | 个人 | 机构 | 商业（报价/预算） |
| --- | :-: | :-: | :-: |
| `public` 公众/匿名下钻 | ✗ | ✗ | ✗ |
| `reviewer` 评审专家 | ✓ | ✓ | ✗ |
| `office` 项目办公室 | ✓ | ✓ | ✓ |
| `finance` 财务 | ✗ | ✓ | ✓ |
| `supplier` 供应商 | ✗ | ✗ | ✓ |

脱敏只在读出时进行，不改动存储。

---

## 4. 目录结构

```
contracts/domain.schema.json   事件信封 + 21 类事件载荷 $defs + x-classification 密级
src/
  domain.ts                    领域类型与事件↔聚合归属（TS）
  contracts.js                 运行期映射、门禁序列、类别中文名
  validator.js                 信封与载荷最小校验（零依赖）
  store/event-store.js         只增事件存储、不可变与版本约束、JSONL 重放
  projector.js                 事件流 → 决策链读模型（门禁状态/阻塞/演示下钻）
  workflow/gates.js            门禁能否下结论、能否上线的流转规则
  policies/
    similarity.js              雷同信号（只提示）
    change-policy.js           变更分级、受影响门禁、学术意见沿用
    special-review.js          海外/原址/AIGC 范围核对 + 人工复核
    interaction.js             匿名互动治理、断言证据溯源
  platform.js                  服务门面：把以上组装为同一条决策链
  redact.js                    按角色字段级脱敏
  server.js / cli.js           HTTP 接口 / 命令行
scripts/demo.js                端到端样例（命题→上线→设备替换再发布）
tests/                         59 个测试
```

---

## 5. 本地使用

```bash
node --test                     # 运行全部测试
node scripts/demo.js            # 端到端演示（内存）
node scripts/demo.js --file data/demo-store.jsonl   # 同时落盘

# CLI（查看与变更预判）
node src/cli.js --file data/demo-store.jsonl list
node src/cli.js --file data/demo-store.jsonl show   PROP-AXIS-2026-014
node src/cli.js --file data/demo-store.jsonl drilldown PROP-AXIS-2026-014
node src/cli.js --file data/demo-store.jsonl change-preview PROP-AXIS-2026-014 device_replacement device_stack

# HTTP 服务
node src/server.js --file data/demo-store.jsonl --port 8080
#   GET /health
#   GET /proposals
#   GET /proposals/:id
#   GET /proposals/:id/drilldown            （x-role: reviewer 可见机构出处）
#   GET /proposals/:id/change-preview?change_class=schedule_delay
#   POST /proposals/:id/interactions/use    （越界用途返回 422 并留痕）
```

写操作（提交命题、登记素材、下评审结论等）通过平台 API `src/platform.js` 进行；CLI/HTTP 面向决策链查看、下钻、变更预判与互动用途校验。零第三方依赖，Node ≥ 20。

---

## 6. 设计边界（系统不做什么）

- 不自动判定抄袭，只给雷同提示，裁定权在人。
- 不替海外/原址/AIGC 下学术结论，只核对范围一致性并强制人工复核留痕。
- 不把匿名互动数据写成历史事实，也不允许其进入证据链。
- 不原地修改或删除任何已接收记录。

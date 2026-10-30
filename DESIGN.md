---
name: "种子港 / Torrent Harbor"
description: "以清晰状态、稳定数字和中性色面承载多下载器的日常管理。"
colors:
  dark-bg: "#0d0f12"
  dark-surface: "#15181d"
  dark-raised: "#1c2026"
  dark-text: "#edf0f4"
  dark-muted: "#a0a8b4"
  dark-line: "#2c323b"
  dark-blue: "#79afff"
  dark-up: "#aeb9c7"
  dark-positive: "#78b7a5"
  dark-warning: "#e6b778"
  dark-danger: "#f39595"
  light-bg: "#f4f5f7"
  light-surface: "#ffffff"
  light-raised: "#eaedf1"
  light-text: "#202630"
  light-muted: "#566171"
  light-line: "#d7dce3"
  light-blue: "#2568c2"
  light-up: "#59697f"
  light-positive: "#347560"
  light-warning: "#8a5c20"
  light-danger: "#b92e3f"
typography:
  headline:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif'
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "0"
  headline-mobile:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif'
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "0"
  title:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif'
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif'
    fontSize: "14px"
    lineHeight: 1.5
  control:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif'
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.5
  label:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif'
    fontSize: "12px"
    lineHeight: 1.5
  rate:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif'
    fontSize: "30px"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "-0.025em"
  diagnostic:
    fontFamily: "ui-monospace, Consolas, monospace"
    fontSize: "12px"
    lineHeight: 1.7
rounded:
  tag: "4px"
  control: "7px"
  field: "8px"
  callout: "8px"
  toast: "9px"
  panel: "12px"
  sheet: "14px 14px 0 0"
spacing:
  4: "4px"
  8: "8px"
  12: "12px"
  14: "14px"
  16: "16px"
  20: "20px"
  22: "22px"
  24: "24px"
  32: "32px"
components:
  button-primary:
    backgroundColor: "{colors.dark-text}"
    textColor: "{colors.dark-bg}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  button-primary-light:
    backgroundColor: "{colors.light-text}"
    textColor: "{colors.light-bg}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  button-secondary:
    backgroundColor: "{colors.dark-surface}"
    textColor: "{colors.dark-text}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  button-danger:
    backgroundColor: "{colors.dark-danger}"
    textColor: "{colors.dark-bg}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  input:
    backgroundColor: "{colors.dark-surface}"
    textColor: "{colors.dark-text}"
    rounded: "{rounded.field}"
    padding: "10px 12px"
  navigation-active:
    backgroundColor: "{colors.dark-raised}"
    textColor: "{colors.dark-text}"
    rounded: "{rounded.control}"
  state-tag:
    backgroundColor: "{colors.dark-raised}"
    textColor: "{colors.dark-muted}"
    rounded: "{rounded.tag}"
    padding: "3px 7px"
  panel:
    backgroundColor: "{colors.dark-surface}"
    textColor: "{colors.dark-text}"
    rounded: "{rounded.panel}"
---

# Design System: 种子港 / Torrent Harbor

## Overview

**Creative North Star: "种子港工作空间"**

种子港以清楚、克制的工作界面呈现多个下载器、带宽池和规则。品牌来自保留的名称、锚形标识及原有站点图标；大面积中性色面让实际状态、速率和操作结果成为视觉重点。桌面提供紧凑、完整的管理空间，手机使用熟悉的触控列表与导航。

本系统记录已实现的样式，而非待实现的方案。`web/main.js` 依次载入 `style.css`、`features.css`、`workspace.css`；最后一层的主题值与界面覆盖是当前视觉依据。前两层继续提供兼容结构、表单与部分组件细节，不应将它们已被覆盖的绿底、藏青配色重新引入。

证据范围：文档依据当前源码及最终桌面、手机视口截图，结合完整 finish review 与随后两项修复的 ship verdict。截图使用隔离的合成数据；视口模拟不等于手机真机验收。浅色与记录页的部分辅助截图来自前一轮构建；它们不证明所有当前管理页面均已逐页验收。此处不声明后台控制、真实下载器或部署验收结果。

**Key Characteristics:**

- 中性深浅两套主题，蓝色突出下载数据与焦点，其他状态有独立文字说明。
- 系统中文字体、清楚的字号层级与等宽数字特性，优先保障扫描速度。
- 平面容器与细分隔线，浮层才使用阴影。
- 保留原有站点图标、管理表单和规则操作语义。
- 离线、部分数据、缺失与真实零值分别表达。

## Colors

前置令牌给出实际复用的颜色；`dark-*` 与 `light-*` 成对切换。组件示例以深色令牌作为静态预览，实际页面使用主题 CSS 变量动态映射。

### Primary

- **数据蓝**：映射 `--blue` 与 `--down`，用于下载速率、下载曲线、输入光标与多数焦点轮廓。主要操作按钮采用前景与底色反转，不采用蓝色大面积填充。
- **上传灰**：映射 `--up`，用于上传数据标识及虚线上传曲线。上传与下载同时通过方向、文字和线型区分。

### Neutral

- **工作底色**：`--bg`，应用背景、桌面侧栏与顶部栏。
- **面板色**：`--surface`，内容容器、输入框及手机底部导航。
- **抬升色**：`--raised`，选中导航、悬停行、状态标签与内嵌说明。
- **主文字、次文字与分隔线**：分别映射 `--text`、`--muted`、`--line`；`--ink` 是主文字别名。
- **语义状态**：`--green` 仅支持在线等正向状态，`--warn` 提醒待同步或需确认情况，`--danger` 表示错误和危险操作。它们不是额外品牌主色。

**The Theme Pair Rule.** 两套主题共享角色和结构；切换时更换整套语义颜色，不用固定的旧主题色补齐局部组件。

**The State With Words Rule.** 状态颜色必须与可读名称、数量或时间共同出现，不能独自承担在线、部分统计或错误含义。

## Typography

**Body Font:** 系统中文无衬线字体栈，见前置令牌。没有为应用界面另设装饰展示字体。

**Label/Mono Font:** 常规速率仍使用系统字体，并以 `font-variant-numeric: tabular-nums` 稳定数字宽度；诊断原文使用 `ui-monospace, Consolas, monospace`。

### Hierarchy

- **Headline**：页面标题使用前置 headline 令牌；手机切换为 headline-mobile。标题字重为中等偏强，不以装饰字距营造气氛。
- **Title**：桌面面板标题使用 title；手机多数面板标题缩至 (14px)。弹窗标题在桌面为 (18px)，手机为 (16px)。
- **Body / Control**：根字号由 body 定义；常用操作为 control。正文段落行高为 (1.65)，密集表格、状态行和说明主要在 (11–13px)。
- **Rate / Total**：实时速率采用 rate；手机使用 `clamp(20px, 6.15vw, 24px)`、字距 (-0.03em)。累计传输数值桌面为 (24px)，手机为 (22px)，字重均为 (500)。
- **Label**：常规说明使用 label；手机附注约 (10–11px)，图表轴与时间标记约 (9–10px)。这些紧凑值不是可随意推广到表单正文的默认字号。

**The Stable Numerals Rule.** 速率、容量、页码和对齐的数据列使用等宽数字特性；保留 KiB/MiB/GiB 与 B/s 等实际单位，不把速率和累计量混用。

## Layout

桌面侧栏宽 (222px)，主内容随侧栏偏移；顶部栏高 (62px)，内容最大宽 (1560px)，主区域内边距为 (28px 32px 20px)。总览采用 `minmax(0, 1.7fr) minmax(290px, 1fr)` 双列、间距 (20px)。总览的两列各自沿内容高度纵向排列：左列为实时速率与下载器状态，右列为累计传输与带宽去向；正在传输跨全宽。两栏不共享卡片行高，不用固定高度或负边距填补空位。管理页继续使用紧凑表格、筛选栏、批量操作和原有编辑流程；面板行按信息密度分隔，而不是把每个字段都包装成独立卡片。

中间宽度 (761–1100px) 将侧栏缩至 (78px) 图标轨道，并保留按钮的可访问名称和提示；标签与次要信息隐藏。内容内边距缩至 (24px)，总览改为单列，DOM 与视觉顺序均为实时→累计→带宽去向→下载器状态。累计组件保持单实例，切换断点不丢失时间选择和明细展开状态；下载器状态区域在断点移动时保留导航焦点。侧栏设置按钮与其他导航保持相同收起方式，不能留下竖排残字。

手机断点为 (760px) 及以下。顶部栏高 (58px) 并保持可见，左右留白 (16px)。内容为单列，主要面板间距 (14px)，常用面板内边距 (16px)。四个固定入口为“总览、种子、站点、记录”；底栏每项最小高 (48px)，内容底部预留 `84px + safe-area-inset-bottom`。更多页面通过抽屉访问。手机主要监控，连接配置、池和规则编辑、批量控制、更新与接管管理留在桌面流程。

手机种子改用可点按的多行列表；筛选进入独立覆盖层，表单输入与选择器通常为 (16px) 字号并提供 (44px) 操作高度。分页保留 (25 / 50 / 100 / 200 / 300) 条选项。任务详情通过路由状态打开，返回使用原有筛选、页码与列表位置。该行为是实现约束，不能在视觉改动中重置。

**The Device Role Rule.** 响应式改变信息密度和入口形态；手机状态查看与桌面复杂编辑各自保留清楚的操作范围。

## Elevation & Depth

默认面板、按钮和导航没有阴影，依靠背景层级、边框及行分隔表达关系。边框统一使用主题分隔色，通常为 (1px)。不要把浮层阴影复制到普通统计面板。

### Shadow Vocabulary

- **桌面弹窗**：`0 16px 60px #0005`，用于遮罩之上的对话框。
- **手机底部面板**：`0 -8px 40px #0004`，用于从底部呈现的详情或对话框。
- **提示消息**：`0 8px 30px #0004`，短暂浮于工作空间之上。
- **遮罩**：`#0009`；当前没有背景模糊。

**The Flat Workspace Rule.** 工作内容保持平面分层；只有暂时覆盖内容的浮层使用阴影。

## Shapes

容器是有细边框的柔和矩形。面板与桌面弹窗使用 panel 圆角，按钮使用 control，输入框使用 field；标签使用 tag，避免过度胶囊化。手机详情/弹窗采用上方圆角的 sheet 轮廓，最大高 (94dvh)，底部操作留出安全区。站点图像保持原比例适配，其图像圆角为 (4px)；保留原有图像与颜色，不将站点标识统一重画为界面强调色。

## Components

### Buttons

按钮清楚、紧凑，保留文本与标准图标。桌面默认最小高 (36px)，常用内边距由 button 令牌定义。次按钮使用面板底、主文字和细边框，悬停使用抬升色；主按钮反转主文字与底色，悬停使用次文字色。危险按钮使用危险色。禁用态沿用 (0.5) 透明度并阻止操作。

图标按钮一般为 (34px) 正方形；手机顶部与主要可触达操作扩展至约 (40–44px)。文字按钮悬停显示下划线。焦点使用 (2px) 轮廓和 (3px) 偏移；输入框焦点偏移为 (1px)。部分保留的专用组件具有自身焦点规则，因此不能把源码抽样等同于完整无障碍审计。

### Chips / Status

标签以抬升底和次文字为主，错误标签额外使用危险文字。状态必须写出名称。当前任务阶段的常规标签主要通过文字区分，而不是每种状态使用独立鲜艳色块。环境标记继续明确区分演示、只读预览与自动接管。

### Cards / Containers

面板使用 surface、line 和 panel 令牌，没有常驻阴影。桌面标题区通常为 (20px 22px)，总览实时区域为 (22px)，手机主要为 (16px)。站点与下载器行使用整行分隔；可点行悬停使用 raised。

### Inputs / Fields

保留原有带可见标签的输入、选择器、分组、说明、预览及错误文案。普通字段为细边框、面板底、field 圆角和 (10px 12px) 内边距。手机搜索和筛选优先 (44px) 高度、(16px) 输入文字。不要因为统一外观而删掉规则预览、限值含义或恢复说明。

### Navigation

桌面侧栏使用标准线性图标与文本，选中态为 raised 底和主文字；中宽轨道仅保留图标。手机底栏固定四项，并以背景与文字同时标示当前页。抽屉和筛选覆盖层支持 Escape 关闭及 Tab 边界约束；弹窗打开时移动焦点，关闭后尝试回到触发控件。这里记录已实现的键盘处理，不宣称全页面通过屏幕阅读器验收。

### Live Rates / History / Traffic

实时区域首先提供在线数量与同步时间，再并排展示下载与上传；异常提示可以直接进入记录。图表绘制实际采样，样本间隔超过 (30s) 时断线，少于两个点时显示等待连续采样；不补造历史。下载为实线，上传为虚线，两个系列有方向文字。

累计传输提供 (1h / 12h / 24h / 3d / 7d / 全部) 六个范围，默认 (24h)。不足时段或中断直接说明只显示已记录流量；“全部”解释为下载器自身保存的历史累计。统计说明与各下载器明细可展开。缺失累计值显示“—”，真实零保留为“0 B”。

### Pool / Client Freshness

站点列表与详情保留原有站点图标，并明确区分：已同步且为零的速率显示“0 B/s”；无汇总或全部成员待同步显示“—”；部分成员离线时只显示在线成员已知速率，同时给出待同步数量及快照时间。详情标明最早成员快照。下载器离线或过期时保留最后成功时间，并写明当前速率未知。限速字段中的空值可以表示“不限速”，它与观测值未知是不同语义。

**The Known Value Rule.** 零值必须来自有效观测；缺失、过期与部分贡献数据保留各自说明，不能通过数值兜底变成实时零。

### Icons / Motion / Feedback

动作与导航使用现有 Lucide 标准线性 SVG，站点继续使用本地已配置图标，加载失败时使用波浪图标回退。图标仅在已有组件语义中使用，并为独立图标按钮保留可访问名称。

动画服务于状态切换：常规背景变化约 (150ms)，手机侧栏位移为 (200ms ease)。`prefers-reduced-motion: reduce` 下全局关闭动画和过渡，并取消平滑滚动。错误使用文字、颜色和重试操作；提示消息位于可见区，手机底部位置避开固定导航与安全区。

## Do's and Don'ts

### Do:

- **Do** 使用整套主题角色，保留种子港名称、锚形标识与原有站点图标。
- **Do** 保持稳定数字、方向标签、实际单位和同步时间，给部分数据明确范围说明。
- **Do** 保留桌面表格、规则排序、原有表单、控制结果解释与恢复语义。
- **Do** 在实际断点检查抽屉、轨道、固定底栏、长名称、焦点与滚动空间。

### Don't:

- **Don't** 从兼容样式层重新引入已被覆盖的旧主题配色。
- **Don't** 将缺失或离线速率呈现为零，也不要补造未采集的趋势。
- **Don't** 只靠颜色表达异常，或将限速目标、当前速率和回读值混为一谈。
- **Don't** 为普通工作面板增加装饰阴影、无业务作用的动画或额外标语。
- **Don't** 将合成数据截图、浏览器视口模拟或源码检查称为真机、真实下载器或部署验收。

## 一键操作（1.4.0）

总览实时区域底部提供紧凑按钮区，保留双列独立排版。独立管理页使用现有中性色、边框、按钮与主题；手机可以执行和停止已有按钮，创建、编辑、删除使用电脑。编辑器支持多条效果与可滚动站点选择，搜索下的全选、反选仅作用于筛选结果并保留隐藏选择；清空移除所有选择。活动效果明确显示手动或定时恢复、只读预览状态及执行时快照。弹窗支持焦点约束、Escape 和关闭后恢复焦点。

## 限速执行状态（1.4.2）

准备写入、正在写入、等待回读确认使用中性色普通进度，完成后消失。外部修改、写入或回读失败、进程重启遗留未确认及历史待核对使用带文字原因的警告入口；任务详情按上传／下载方向说明状态。诊断状态来源于当前进程操作，不把持久化待确认意图一律当作正常执行。

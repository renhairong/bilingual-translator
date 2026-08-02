# 更新日志 (Changelog)

本项目遵循[语义化版本号](https://semver.org/lang/zh-CN/)：
- **主版本**：不兼容的 API 变更
- **次版本**：向后兼容的功能新增
- **修订号**：向后兼容的缺陷修复

每个版本都会：
1. 更新 `manifest.json` 的 `version` 字段
2. 在此文件记录改动
3. 打 git tag：`v<version>`

## [0.3.0] - 2026-08-02

### 新增
- 页面级语言预判：整页主语言已是目标语言时跳过翻译（中文页不再被误翻译）
- 源语言与目标语言相同时跳过翻译

### 修复
- SPA 导航检测重写（业界标准方案）：MutationObserver 对比 URL + 每秒轮询兜底
  - 修复 Medium 返回首页不翻译的问题（`?source=` 链接用 React 内存恢复 DOM，Observer 不触发，轮询兜底）
  - 修复返回首页后翻译被旧翻译锁阻塞（translateGen 翻译代号机制）
  - 修复 React 分批插入内容漏翻译（补充扫描定时器 1.5s/3s/6s）
- doTranslate 入口增加 `!autoTranslate` 守卫检查
- 中文页面里短拉丁缩写（PDF/URL/API/UI）不再误翻译

### 变更
- SPA 检测不再依赖 pushState/popstate 事件（不可靠）

## [0.2.0] - 2026-07-13

### 新增
- 导航/菜单/侧边栏等 UI 容器文字翻译（inline 模式，不破坏布局）
- line-clamp 容器（卡片标题）译文外移，避免被 overflow 裁切

### 修复
- 自定义样式去掉背景块/边框/padding，布局与默认样式一致
- 段落级对齐校正（实测 getBoundingClientRect 反向偏移）
- 跳过导航/菜单/侧边栏等 UI 容器翻译
- 译文左对齐不缩进，抵消父级 text-indent/padding-left
- 译文继承原文高亮背景色
- popup 高度限制导致按钮被截断

## [0.1.0] - 2026-07-12

### 新增
- 初始版本：AI 双语网页翻译扩展
- 支持 DeepSeek / Qwen / GLM 等模型
- 双语对照 / 仅显示译文 两种模式
- 译文样式：默认样式 / 自定义样式
- 翻译缓存（按 URL + 语言对持久化）
- 批量翻译 + SPA 动态内容自动翻译

// 双语 AI 翻译 - Content Script（修复版）
// 修复：翻译锁 + 跳过译文span + DOM级去重 + Observer 暂停

const IGNORE_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT',
  'CODE', 'PRE', 'SVG', 'PATH', 'SYMBOL', 'TEMPLATE'
]);
const TRANSLATED_SPAN_CLASS = 'ai-translation-zh';
const ORIGINAL_SPAN_CLASS = 'ai-original-text';
const BODY_ZH_ONLY_CLASS = 'ai-translation-zh-only';
const BATCH = 10;

let autoTranslate = true;
let mode = 'bilingual';
let styleMode = 'inherit'; // 译文样式：inherit=继承原网页样式，custom=自定义样式
let styleCfg = {};
let translated = new WeakSet();
let isTranslating = false;
let showingOriginal = false;
let sourceLang = 'auto';
let targetLang = 'zh-CN';
let contextInvalidated = false; // 扩展重载后上下文失效，后续翻译静默停止
let spaRetryCount = 0; // SPA 页面延迟重试计数
const SPA_RETRY_DELAYS = [800, 1500, 3000]; // 重试间隔（ms）
let followUpCount = 0; // 翻译后补充扫描计数
const MAX_FOLLOWUPS = 3; // 最多补充扫描次数
let lastUrl = location.href; // SPA URL 变化检测

// 语言名称映射（用于提示词）
const LANG_NAMES = {
  auto: '源语言',
  'zh-CN': '中文', ja: '日语', ko: '韩语',
  es: '西班牙语', de: '德语', fr: '法语', en: '英语'
};

// 语言字符集判断：统计各语言字符数量
function charScript(text) {
  let cjk = 0, hiragana = 0, katakana = 0, hangul = 0, latin = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if ((c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3400 && c <= 0x4DBF)) cjk++;
    else if (c >= 0x3040 && c <= 0x309F) hiragana++;
    else if (c >= 0x30A0 && c <= 0x30FF) katakana++;
    else if (c >= 0xAC00 && c <= 0xD7AF) hangul++;
    else if ((c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A)) latin++;
  }
  return { cjk, hiragana, katakana, hangul, latin, total: text.length };
}

// —— 快速检测：只要含一个对应字符就返回 true ——
function hasCJK(text) {
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if ((c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3400 && c <= 0x4DBF)) return true;
  }
  return false;
}
function hasKana(text) {
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if ((c >= 0x3040 && c <= 0x309F) || (c >= 0x30A0 && c <= 0x30FF)) return true;
  }
  return false;
}
function hasHangul(text) {
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if (c >= 0xAC00 && c <= 0xD7AF) return true;
  }
  return false;
}

// 是否可能属于目标语言（source=auto 时过滤掉，避免把译文再翻）
function looksLikeLang(text, lang) {
  const s = charScript(text);
  if (s.total < 2) return false;
  const t = s.latin + s.cjk + s.hiragana + s.katakana + s.hangul;
  if (t / s.total < 0.4) return false;
  switch (lang) {
    case 'zh-CN': return s.cjk > 0 && s.cjk >= s.latin;
    case 'ja':    return (s.hiragana + s.katakana) > 0 || (s.cjk > s.latin && s.cjk > 0);
    case 'ko':    return s.hangul > 0;
    case 'en':    return s.latin / t > 0.7;
    case 'es': case 'de': case 'fr': default: return s.latin / t > 0.7;
  }
}

// 目标语言不应被收集（防止译文再翻译）
// 核心难点：CJK 字符在中日文中共用，需区分"已经是目标语言"vs"需要翻译到目标语言"
function isTargetLang(text) {
  if (targetLang === 'zh-CN') {
    // 中文目标：纯 CJK（无假名、无谚文）→ 可能是中文，跳过
    // 含假名 → 是日语，需要翻译成中文，不跳过
    // 含谚文 → 是韩语，需要翻译成中文，不跳过
    // 纯拉丁 → 英/西/德/法等，需要翻译成中文，不跳过
    if (hasCJK(text) && !hasKana(text) && !hasHangul(text)) return true;
    return false;
  }
  if (targetLang === 'ja') {
    // 日语目标：含假名 → 是日语，跳过；纯 CJK（无假名）→ 可能是中文，需翻译成日语
    if (hasKana(text)) return true;
    return false;
  }
  if (targetLang === 'ko') {
    // 韩语目标：含谚文 → 是韩语，跳过
    if (hasHangul(text)) return true;
    return false;
  }
  // 拉丁语言目标：用比例判断
  if (['en', 'es', 'de', 'fr'].includes(targetLang) && looksLikeLang(text, targetLang)) return true;
  return false;
}

// 纯数字/价格/日期类文本不翻译
// 扩展：支持 CJK 数字单位（年月日时分秒万千百十亿个等）
function isPureNumbers(text) {
  const t = text.trim();
  if (t.length < 1) return true;
  // 去掉 CJK 数字相关字符后判断
  const cleaned = t.replace(/[年月日时分秒万千百十亿个亿万佰仟圆元角分号]/g, '');
  const digits = (cleaned.match(/\d/g) || []).length;
  const letters = (cleaned.match(/[a-zA-Z]/g) || []).length;
  const symbols = (cleaned.match(/[\s.,;:!?()\[\]{}\-–—+*/=%$¥€£₩©®™#@&·\/~^]/g) || []).length;
  const remaining = cleaned.length;
  // 无字母、有数字、数字+符号占绝大部分
  return digits > 0 && letters === 0 && (digits + symbols) / t.length > 0.6;
}

// source=指定语言时，是否属于该语言
function matchesSourceLang(text, lang) {
  const trimmed = text.trim();
  if (lang === 'auto') {
    // 自动检测模式：
    // 1. 纯数字/价格/日期不翻
    if (isPureNumbers(trimmed)) return false;
    // 2. 已经是目标语言的文本不翻
    if (isTargetLang(trimmed)) return false;
    // 3. 没有任何可识别语言字符的纯符号/空白不翻
    //    至少 1 个拉丁字母或 1 个 CJK/假名/谚文字符即可（原来是 2 个，会漏掉单词如 "Boring"）
    const s = charScript(trimmed);
    const hasOneChar = s.latin + s.cjk + s.hiragana + s.katakana + s.hangul >= 1;
    if (!hasOneChar) return false;
    return true;
  }
  // 指定源语言模式
  const s = charScript(text);
  switch (lang) {
    case 'ja': return (s.hiragana + s.katakana) / Math.max(s.total, 1) > 0.1 || (s.cjk > s.latin && (s.hiragana + s.katakana) > 0);
    case 'ko': return s.hangul / Math.max(s.total, 1) > 0.2;
    case 'zh-CN': return s.cjk / Math.max(s.total, 1) > 0.4;
    case 'es': case 'de': case 'fr':
    default: return s.latin / Math.max(s.total, 1) > 0.6;
  }
}

// DOM 级去重：检查该文本节点旁边是否已有译文 span
function alreadyHasTranslation(textNode) {
  const next = textNode.nextSibling;
  return next && next.nodeType === Node.ELEMENT_NODE && next.classList.contains(TRANSLATED_SPAN_CLASS);
}

function collectTextNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const val = node.nodeValue;
      if (!val || !val.trim()) return NodeFilter.FILTER_REJECT;
      // [修复1] WeakSet 引用去重
      if (translated.has(node)) return NodeFilter.FILTER_REJECT;
      // [修复2] 根据语言设置过滤文本
      if (!matchesSourceLang(val, sourceLang)) return NodeFilter.FILTER_REJECT;
      // [修复3] 跳过译文 span 内部的文本 + 忽略特定标签
      // 注意：aria-hidden 只检查直接父级，不检查祖先（Medium 等网站祖先容器有 aria-hidden 但内容可见）
      const directParent = node.parentElement;
      if (directParent && directParent.classList && directParent.classList.contains(TRANSLATED_SPAN_CLASS)) {
        return NodeFilter.FILTER_REJECT;
      }
      if (directParent && directParent.getAttribute && directParent.getAttribute('aria-hidden') === 'true') {
        return NodeFilter.FILTER_REJECT;
      }
      let p = directParent;
      while (p) {
        if (IGNORE_TAGS.has(p.tagName)) return NodeFilter.FILTER_REJECT;
        p = p.parentElement;
      }
      // [修复4] DOM 级去重：旁边已有译文则跳过（处理 TextNode 被 SPA/动态页重建的情况）
      if (alreadyHasTranslation(node)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);
  return nodes;
}

function applyStyle(span) {
  if (styleMode !== 'custom') return;
  if (styleCfg.color) span.style.color = styleCfg.color;
  if (styleCfg.size) span.style.fontSize = styleCfg.size;
}

// 检查扩展上下文是否仍然有效（扩展重载后，旧 content script 的 chrome runtime 会失效）
function isExtensionContextValid() {
  try {
    const ok = !!(chrome && chrome.runtime && chrome.runtime.id);
    if (!ok) contextInvalidated = true;
    return ok;
  } catch (e) {
    contextInvalidated = true;
    return false;
  }
}

function safeSendMessage(msg, cb) {
  if (!isExtensionContextValid()) {
    cb && cb({ ok: false, error: 'Extension context invalidated' });
    return;
  }
  try {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) {
        cb && cb({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      cb && cb(resp);
    });
  } catch (e) {
    cb && cb({ ok: false, error: e.message });
  }
}

function safeStorageSet(obj) {
  if (!isExtensionContextValid()) return;
  try {
    chrome.storage.local.set(obj);
  } catch (e) {
    console.warn('[双语翻译]', e.message);
  }
}

function safeStorageGet(keys, cb) {
  if (!isExtensionContextValid()) return;
  try {
    chrome.storage.sync.get(keys, (c) => {
      if (chrome.runtime.lastError) {
        console.warn('[双语翻译]', chrome.runtime.lastError.message);
        return;
      }
      cb(c);
    });
  } catch (e) {
    console.warn('[双语翻译]', e.message);
  }
}

function safeStorageOnChanged(cb) {
  if (!isExtensionContextValid()) return;
  try {
    chrome.storage.onChanged.addListener(cb);
  } catch (e) {
    console.warn('[双语翻译]', e.message);
  }
}

function safeRuntimeOnMessage(cb) {
  if (!isExtensionContextValid()) return;
  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      cb(msg, sender, sendResponse);
      return true; // 保持消息通道开放，允许异步响应
    });
  } catch (e) {
    console.warn('[双语翻译]', e.message);
  }
}

// 根据当前模式给 body 加/去 class，实时控制原文显隐
function applyZhOnlyMode() {
  if (mode === 'zh-only') document.body.classList.add(BODY_ZH_ONLY_CLASS);
  else document.body.classList.remove(BODY_ZH_ONLY_CLASS);
}

function isInsideParagraph(textNode) {
  const inlineTags = new Set(['SPAN', 'A', 'STRONG', 'EM', 'B', 'I', 'U', 'MARK', 'SMALL', 'SUB', 'SUP', 'CODE', 'S', 'DEL', 'INS', 'KBD', 'ABBR', 'CITE', 'Q', 'TIME', 'DFN', 'VAR']);
  // 明确的段落/正文标签：这些标签内的文本一律视为正文
  const paragraphTags = new Set(['P', 'LI', 'DD', 'DT', 'BLOCKQUOTE', 'FIGCAPTION', 'TD', 'TH', 'ARTICLE', 'SECTION', 'MAIN', 'DETAILS', 'SUMMARY']);
  let p = textNode.parentElement;
  while (p && inlineTags.has(p.tagName)) {
    p = p.parentElement;
  }
  if (!p) return false;
  // 明确的段落标签 → 正文样式
  if (paragraphTags.has(p.tagName)) return true;
  // DIV 需要进一步判断：如果位于 ARTICLE/MAIN/SECTION 内容容器内 → 正文样式
  if (p.tagName === 'DIV') {
    let ancestor = p.parentElement;
    while (ancestor && ancestor !== document.body && ancestor !== document.documentElement) {
      if (paragraphTags.has(ancestor.tagName)) return true;
      ancestor = ancestor.parentElement;
    }
    // DIV 本身具有内容属性（role=article, data-*, class 含 article/body/content/news/text 等）
    const role = p.getAttribute('role');
    if (role === 'article' || role === 'main') return true;
    const cls = (p.className || '').toLowerCase();
    if (/\b(article|body|content|news|text|entry|post|story|paragraph|desc|detail)\b/.test(cls)) return true;
    const id = (p.id || '').toLowerCase();
    if (/\b(article|body|content|news|text|entry|post|story|paragraph|desc|detail)\b/.test(id)) return true;
  }
  return false;
}

// 提取元素上链上「第一个有效」的 background-color
// 沿父级链向上查找：找到第一个真正有背景色的祖先（不是 transparent / rgba 0）
// 用于让译文继承原网页自带的高亮背景（黄色、淡绿色等）
function getEffectiveBackgroundColor(node) {
  if (!node) return '';
  let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  while (el && el !== document.documentElement) {
    const bg = getComputedStyle(el).backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
      // 还要检查是否被 background-image 覆盖（不覆盖即可）
      return bg;
    }
    el = el.parentElement;
  }
  return '';
}

// 判断文本节点是否位于导航/菜单/侧边栏等 UI 容器中
// 这类容器里的文字通常是 UI 标签（Home/Library 等），翻译会破坏布局
function isInUINavContainer(node) {
  if (!node) return false;
  const navTags = new Set(['NAV', 'ASIDE', 'MENU', 'HEADER', 'FOOTER']);
  let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  while (el && el !== document.body) {
    if (navTags.has(el.tagName)) return true;
    // role 属性也是导航/菜单
    const role = el.getAttribute && el.getAttribute('role');
    if (role && /^(navigation|menubar|menu|tablist|tab)$/i.test(role)) return true;
    el = el.parentElement;
  }
  return false;
}

// 查找最近的 -webkit-line-clamp 容器（如 Medium 卡片标题 h2）
// 这类容器的 overflow:hidden 会裁切超出行数的 block 译文
function findClampedContainer(node) {
  if (!node) return null;
  let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  while (el && el !== document.body) {
    const cs = window.getComputedStyle(el);
    const clampVal = cs.getPropertyValue('-webkit-line-clamp');
    if (clampVal && clampVal !== 'none' && parseInt(clampVal) > 0) return el;
    el = el.parentElement;
  }
  return null;
}

function insertTranslation(textNode, zh) {
  translated.add(textNode);
  const parent = textNode.parentElement;
  if (!parent) return;

  // 跳过导航/菜单/侧边栏等 UI 容器的翻译
  if (isInUINavContainer(textNode)) return;

  // 用 <span class="ai-original-text"> 包裹原文
  const orig = document.createElement('span');
  orig.className = ORIGINAL_SPAN_CLASS;
  textNode.parentNode.insertBefore(orig, textNode);
  orig.appendChild(textNode);

  // 提取原文所在上下文链上的背景色（高亮背景）
  // 这样无论用户选「默认样式」还是「自定义样式」，译文都能继承原网页的高亮背景
  const inheritBg = getEffectiveBackgroundColor(parent);

  // 插入译文 span
  const span = document.createElement('span');
  const classes = [TRANSLATED_SPAN_CLASS];
  classes.push(styleMode === 'custom' ? 'ai-style-custom' : 'ai-style-inherit');
  const inParagraph = isInsideParagraph(textNode);
  if (inParagraph) classes.push('ai-translation-zh-body');
  if (inheritBg) {
    classes.push('ai-style-with-inherit-bg');
    span.style.backgroundColor = inheritBg;
  }
  span.className = classes.join(' ');
  span.textContent = zh;
  applyStyle(span);
  parent.insertBefore(span, orig.nextSibling);

  // line-clamp 容器（如 Medium 卡片标题）：译文改插到 clampedEl 外面作为兄弟
  // 避免被 overflow:hidden 裁掉，同时不破坏容器原有布局
  const clampedEl = findClampedContainer(textNode);
  if (clampedEl) {
    span.remove();
    clampedEl.parentNode.insertBefore(span, clampedEl.nextSibling);
    span.classList.remove('ai-translation-zh-body');
    span.classList.add('ai-translation-zh-after-clamp');
  }

  // 段落级对齐校正：插入后实测译文左边界 vs 原文左边界，
  // 如果译文向右偏了超过 8px，说明父级有 text-indent/padding 让 block 级译文被推后
  // 用负 margin-left 把译文拉回与原文左对齐
  // 仅在正文段落（inParagraph）时启用，避免误伤导航等 UI 容器
  // 外移的译文（ai-translation-zh-after-clamp）不在 orig 旁边，跳过对齐
  if (inParagraph && !span.classList.contains('ai-translation-zh-after-clamp')) {
    try {
      const origRect = orig.getBoundingClientRect();
      const spanRect = span.getBoundingClientRect();
      const offset = spanRect.left - origRect.left;
      // 只在「明显偏移」（>=8px 且 <200px，防止误伤布局）时调整
      if (offset >= 8 && offset < 200) {
        span.style.marginLeft = (-offset) + 'px';
      }
    } catch (e) { /* 忽略测量错误 */ }
  }
}

function translateBatch(texts) {
  return new Promise((resolve) => {
    safeSendMessage({ type: 'translate', texts, url: location.href, sourceLang, targetLang }, (resp) => {
      if (resp && resp.ok) {
        // 翻译成功，清除之前的错误
        safeStorageSet({ lastError: null });
        resolve(resp.translations);
      } else {
        const errMsg = (resp && resp.error) || '翻译请求失败';
        // 扩展上下文已失效：静默跳过，不记录错误、不污染 popup 提示
        if (contextInvalidated) {
          resolve(texts.map(() => ''));
          return;
        }
        console.warn('[双语翻译]', errMsg);
        // 存储错误供 popup 展示
        safeStorageSet({ lastError: { message: errMsg, ts: Date.now() } });
        resolve(texts.map(() => ''));
      }
    });
  });
}

// 核心翻译函数：带锁 + 暂停 Observer 防循环 + SPA 延迟重试 + 翻译后补充扫描
async function doTranslate() {
  if (isTranslating || showingOriginal || contextInvalidated) return;
  isTranslating = true;
  observer.disconnect();

  try {
    const nodes = collectTextNodes(document.body);
    console.log('[双语翻译] 收集到', nodes.length, '个待翻译节点');
    if (!nodes.length) {
      // SPA 页面内容可能尚未加载完成，延迟重试
      if (spaRetryCount < SPA_RETRY_DELAYS.length) {
        const delay = SPA_RETRY_DELAYS[spaRetryCount];
        spaRetryCount++;
        console.log('[双语翻译] 未收集到节点，', delay + 'ms 后重试 (第', spaRetryCount, '次)');
        isTranslating = false;
        if (!contextInvalidated) observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => {
          if (autoTranslate && !showingOriginal && !contextInvalidated) doTranslate();
        }, delay);
        return;
      }
      spaRetryCount = 0; // 重置计数
      return;
    }
    spaRetryCount = 0; // 成功收集到节点，重置计数

    let okCount = 0, failCount = 0;
    for (let i = 0; i < nodes.length; i += BATCH) {
      const batchNodes = nodes.slice(i, i + BATCH);
      const texts = batchNodes.map((n) => n.nodeValue.trim());
      const translations = await translateBatch(texts);
      batchNodes.forEach((node, j) => {
        const zh = translations[j];
        if (zh && zh.trim()) {
          insertTranslation(node, zh.trim());
          okCount++;
        } else {
          failCount++;
        }
      });
    }
    applyZhOnlyMode();
    console.log('[双语翻译] 翻译完成: 成功', okCount, '失败', failCount);

    // 翻译后补充扫描：翻译期间可能有新内容被加载到 DOM 中
    // Observer 在翻译期间被断开，这些新内容不会被捕获，需要主动扫描
    const remaining = collectTextNodes(document.body);
    if (remaining.length > 0 && followUpCount < MAX_FOLLOWUPS) {
      followUpCount++;
      console.log('[双语翻译] 发现', remaining.length, '个新节点，补充扫描 (第', followUpCount, '次)');
      isTranslating = false;
      if (!contextInvalidated) observer.observe(document.body, { childList: true, subtree: true });
      clearTimeout(observerTimer);
      observerTimer = setTimeout(doTranslate, 500);
      return;
    }
    followUpCount = 0; // 重置补充扫描计数
  } finally {
    isTranslating = false;
    if (!contextInvalidated) observer.observe(document.body, { childList: true, subtree: true });
  }
}

// 移除所有翻译 span，恢复页面原始状态
function removeTranslations() {
  translated = new WeakSet(); // 重建 WeakSet 清空所有标记
  // 移除译文 span
  document.querySelectorAll('.' + TRANSLATED_SPAN_CLASS).forEach((e) => e.remove());
  // unwrap 原文：把 <span class="ai-original-text"> 替换回裸文本节点
  document.querySelectorAll('.' + ORIGINAL_SPAN_CLASS).forEach((orig) => {
    while (orig.firstChild) orig.parentNode.insertBefore(orig.firstChild, orig);
    orig.remove();
  });
  // 移除模式 class
  document.body.classList.remove(BODY_ZH_ONLY_CLASS);
}

function loadConfigAndTranslate() {
  safeStorageGet(['autoTranslate', 'mode', 'styleMode', 'zhColor', 'zhSize', 'sourceLang', 'targetLang'], (c) => {
    autoTranslate = c.autoTranslate !== false;
    mode = c.mode || 'bilingual';
    // 首次使用默认继承；老用户（只有 zhColor 没有 styleMode）保持自定义以兼容旧行为
    styleMode = c.styleMode || (c.zhColor ? 'custom' : 'inherit');
    styleCfg = { color: c.zhColor, size: c.zhSize };
    sourceLang = c.sourceLang || 'auto';
    targetLang = c.targetLang || 'zh-CN';
    applyZhOnlyMode();
    if (autoTranslate) doTranslate();
  });
}

// Observer：SPA 动态加载新内容后自动翻译
let observerTimer = null;
const observer = new MutationObserver(() => {
  if (!autoTranslate || isTranslating || showingOriginal || contextInvalidated) return;
  clearTimeout(observerTimer);
  observerTimer = setTimeout(doTranslate, 1500);
});

safeStorageOnChanged((changes, area) => {
  if (area !== 'sync' || !isExtensionContextValid()) return;

  if (changes.autoTranslate) {
    autoTranslate = changes.autoTranslate.newValue !== false;
    showingOriginal = false;
    if (!autoTranslate) removeTranslations();
    else { removeTranslations(); doTranslate(); }
  }

  if (changes.mode) {
    mode = changes.mode.newValue || 'bilingual';
    applyZhOnlyMode(); // 实时切换原文显隐，无需重翻
  }

  if (changes.styleMode) {
    styleMode = changes.styleMode.newValue || 'inherit';
    document.querySelectorAll('.' + TRANSLATED_SPAN_CLASS).forEach((span) => {
      span.classList.remove('ai-style-inherit', 'ai-style-custom');
      span.classList.add(styleMode === 'custom' ? 'ai-style-custom' : 'ai-style-inherit');
      if (styleMode === 'custom') applyStyle(span);
      else { span.style.color = ''; span.style.fontSize = ''; }
    });
  }

  if (changes.zhColor || changes.zhSize) {
    styleCfg = { color: changes.zhColor?.newValue || styleCfg.color, size: changes.zhSize?.newValue || styleCfg.size };
    document.querySelectorAll('.' + TRANSLATED_SPAN_CLASS + '.ai-style-custom').forEach(applyStyle);
  }

  if (changes.sourceLang) sourceLang = changes.sourceLang.newValue || 'auto';
  if (changes.targetLang) targetLang = changes.targetLang.newValue || 'zh-CN';
});

safeRuntimeOnMessage((msg, sender, sendResponse) => {
  if (!isExtensionContextValid()) return;
  if (msg.type === 'toggle') {
    autoTranslate = msg.value;
    showingOriginal = false; // 用户主动操作，解除「显示原文」保护
    if (autoTranslate) { removeTranslations(); doTranslate(); }
    else removeTranslations();
    sendResponse({ ok: true });
  } else if (msg.type === 'remove') {
    // 「显示原文」：清除译文 + 置标志阻止 Observer 自动重翻
    showingOriginal = true;
    removeTranslations();
    sendResponse({ ok: true });
  } else if (msg.type === 'rerun') {
    // 「重新翻译」：清除「显示原文」状态 + 清除所有翻译 + 重新翻译
    showingOriginal = false;
    spaRetryCount = 0;
    followUpCount = 0;
    removeTranslations();
    doTranslate();
    sendResponse({ ok: true });
  } else if (msg.type === 'langChange') {
    sourceLang = msg.sourceLang || 'auto';
    targetLang = msg.targetLang || 'zh-CN';
    sendResponse({ ok: true });
  }
});

// —— SPA URL 变化检测 ——
// Medium 等 SPA 网站通过 History API 切换页面时不会触发页面刷新，
// content script 不会重新执行，需要主动检测 URL 变化并重新翻译。
function onUrlChange() {
  if (location.href === lastUrl) return;
  lastUrl = location.href;
  console.log('[双语翻译] SPA URL 变化:', location.href);
  // 重置所有状态
  spaRetryCount = 0;
  followUpCount = 0;
  isTranslating = false;
  removeTranslations();
  if (autoTranslate && !showingOriginal && !contextInvalidated) {
    clearTimeout(observerTimer);
    observerTimer = setTimeout(doTranslate, 500);
  }
}

// Hook History API
const _origPushState = history.pushState;
const _origReplaceState = history.replaceState;
history.pushState = function () {
  _origPushState.apply(this, arguments);
  setTimeout(onUrlChange, 100);
};
history.replaceState = function () {
  _origReplaceState.apply(this, arguments);
  setTimeout(onUrlChange, 100);
};
window.addEventListener('popstate', onUrlChange);

loadConfigAndTranslate();
observer.observe(document.body, { childList: true, subtree: true });

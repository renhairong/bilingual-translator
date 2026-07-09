// 双语 AI 翻译 - Background Service Worker（带 URL 缓存）
// 职责：中转大模型 API 调用，规避 CORS，保护 API Key；按 URL 持久化缓存翻译结果。

const CACHE_PREFIX = 'trcache:';
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 天过期

const LANG_NAMES = {
  auto: '源语言',
  'zh-CN': '中文', ja: '日语', ko: '韩语',
  es: '西班牙语', de: '德语', fr: '法语', en: '英语'
};

// 缓存 key 包含语言对，避免不同语言设置混淆
function cacheKeyFor(url, sourceLang, targetLang) {
  return CACHE_PREFIX + (sourceLang || 'auto') + ':' + (targetLang || 'zh-CN') + ':' + url;
}

// 简单哈希，作为单句文本的缓存 key（避免把长原文直接当 storage key）
function hashText(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

// 接受完整的 cache key（由 translate() 计算后传入）
function loadUrlCache(cacheKey) {
  return new Promise((resolve) => {
    chrome.storage.local.get(cacheKey, (res) => {
      resolve(res[cacheKey] || {});
    });
  });
}

function saveUrlCache(cacheKey, cache) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [cacheKey]: cache }, resolve);
  });
}

const PRESETS = {
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', keyField: 'apiKey_deepseek' },
  qwen:     { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', keyField: 'apiKey_qwen' },
  glm:      { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', keyField: 'apiKey_glm' }
};

function keyFieldFor(baseUrl) {
  const u = (baseUrl || '').replace(/\/+$/, '');
  for (const key of Object.keys(PRESETS)) {
    if (PRESETS[key].baseUrl.replace(/\/+$/, '') === u) return PRESETS[key].keyField;
  }
  return 'apiKey';
}

function getConfig() {
  return new Promise((resolve) => {
    const keyFields = Object.values(PRESETS).map(p => p.keyField);
    chrome.storage.sync.get(
      ['baseUrl', 'apiKey', 'model', 'autoTranslate', 'mode', 'zhColor', 'zhSize', 'sourceLang', 'targetLang', ...keyFields],
      (c) => {
        const baseUrl = c.baseUrl || 'https://api.deepseek.com/v1';
        const keyField = keyFieldFor(baseUrl);
        // 优先读取分模型 key；若不存在，回退旧版通用 apiKey（兼容迁移）
        let apiKey = c[keyField] || '';
        if (!apiKey && c.apiKey) apiKey = c.apiKey;
        resolve({
          baseUrl,
          apiKey,
          model: c.model || 'deepseek-chat',
          autoTranslate: c.autoTranslate !== false,
          mode: c.mode || 'bilingual',
          zhColor: c.zhColor || '',
          zhSize: c.zhSize || '',
          sourceLang: c.sourceLang || 'auto',
          targetLang: c.targetLang || 'zh-CN'
        });
      }
    );
  });
}

// 核心 API 调用（不含缓存逻辑）
async function callApi(texts, config) {
  const url = config.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const numbered = texts.map((t, i) => `${i + 1}. ${t}`).join('\n');

  const srcName = LANG_NAMES[config.sourceLang] || '源语言';
  const tgtName = LANG_NAMES[config.targetLang] || '中文';
  let systemPrompt;
  if (config.sourceLang === 'auto') {
    systemPrompt =
      `你是一个专业的多语言翻译引擎。用户会发送若干编号的文本段落，` +
      `请自动检测每段文本的源语言，将其翻译为${tgtName}。` +
      `保持编号顺序，每行以 "编号. 译文" 的格式返回，` +
      `不要添加任何解释、前缀或多余内容。专有名词可保留原文。`;
  } else {
    systemPrompt =
      `你是一个专业的${srcName}译${tgtName}翻译引擎。用户会发送若干编号的${srcName}文本段落，` +
      `你需要逐段翻译为${tgtName}，保持编号顺序，每行以 "编号. 译文" 的格式返回，` +
      `不要添加任何解释、前缀或多余内容。专有名词可保留原文。`;
  }

  const body = {
    model: config.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: numbered }
    ],
    temperature: 0.3,
    stream: false
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + config.apiKey
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const err = await resp.text().catch(() => '');
    throw new Error('API ' + resp.status + ': ' + err.slice(0, 200));
  }

  const data = await resp.json();
  const content = (data.choices && data.choices[0] && data.choices[0].message.content) || '';

  const map = {};
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*(\d+)\.\s*(.*)$/);
    if (m) map[Number(m[1])] = m[2].trim();
  }
  return texts.map((t, i) => (map[i + 1] !== undefined ? map[i + 1] : ''));
}

// 带缓存的翻译入口：命中缓存直接返回，未命中才调 API
async function translate(texts, config, pageUrl) {
  const cacheKey = cacheKeyFor(pageUrl, config.sourceLang, config.targetLang);
  const cache = await loadUrlCache(cacheKey);
  const now = Date.now();

  const results = new Array(texts.length);
  const missTexts = [];
  const missIdx = [];

  texts.forEach((t, i) => {
    const h = hashText(t);
    const entry = cache[h];
    if (entry && now - entry.ts < CACHE_TTL) {
      results[i] = entry.zh; // 命中缓存
    } else {
      results[i] = null; // 未命中
      missTexts.push(t);
      missIdx.push(i);
    }
  });

  if (missTexts.length) {
    const tr = await callApi(missTexts, config);
    missTexts.forEach((t, k) => {
      const zh = tr[k] || '';
      results[missIdx[k]] = zh;
      cache[hashText(t)] = { zh, ts: now };
    });
    await saveUrlCache(cacheKey, cache);
  }

  return results;
}

// 缓存管理：统计 / 清除
async function getCacheStats() {
  const all = await new Promise((res) => chrome.storage.local.get(null, res));
  let urls = 0;
  let entries = 0;
  for (const k of Object.keys(all)) {
    if (k.startsWith(CACHE_PREFIX)) {
      urls++;
      entries += Object.keys(all[k]).length; // 每个 hash 即一条译文
    }
  }
  return { urls, entries };
}

async function clearAllCache() {
  const all = await new Promise((res) => chrome.storage.local.get(null, res));
  const keys = Object.keys(all).filter((k) => k.startsWith(CACHE_PREFIX));
  if (keys.length) await new Promise((res) => chrome.storage.local.remove(keys, res));
  return keys.length;
}

// 清除指定 URL 的所有缓存（不限语言对）
async function clearPageCache(url) {
  if (!url) return 0;
  const all = await new Promise((res) => chrome.storage.local.get(null, res));
  const keysToRemove = [];
  for (const k of Object.keys(all)) {
    if (!k.startsWith(CACHE_PREFIX)) continue;
    // Key 格式: trcache:sourceLang:targetLang:url
    // sourceLang 和 targetLang 不含冒号，URL 在第二个冒号之后
    const rest = k.slice(CACHE_PREFIX.length);
    const c1 = rest.indexOf(':');
    if (c1 === -1) continue;
    const c2 = rest.indexOf(':', c1 + 1);
    if (c2 === -1) continue;
    const keyUrl = rest.slice(c2 + 1);
    if (keyUrl === url) keysToRemove.push(k);
  }
  if (keysToRemove.length) {
    await new Promise((res) => chrome.storage.local.remove(keysToRemove, res));
  }
  return keysToRemove.length;
}

async function handle(msg, sendResponse) {
  const config = await getConfig();
  if (!config.apiKey) {
    sendResponse({ ok: false, error: '未配置 API Key，请在扩展设置中填写。' });
    return;
  }
  // 翻译请求中的语言参数优先于全局存储
  if (msg.sourceLang) config.sourceLang = msg.sourceLang;
  if (msg.targetLang) config.targetLang = msg.targetLang;
  try {
    const pageUrl = msg.url || (msg.tab && msg.tab.url) || location.href;
    const translations = await translate(msg.texts, config, pageUrl);
    sendResponse({ ok: true, translations });
  } catch (e) {
    sendResponse({ ok: false, error: e.message });
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'translate') {
    handle(msg, sendResponse);
    return true; // 保持消息通道开放以支持异步响应
  }
  if (msg.type === 'getCacheStats') {
    getCacheStats().then(sendResponse);
    return true; // 异步响应，保持通道
  }
  if (msg.type === 'clearCache') {
    if (msg.url) {
      clearPageCache(msg.url).then((n) => sendResponse({ ok: true, removed: n }));
    } else {
      clearAllCache().then((n) => sendResponse({ ok: true, removed: n }));
    }
    return true; // 异步响应，保持通道
  }
  return false;
});

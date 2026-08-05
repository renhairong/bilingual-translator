// 双语 AI 翻译 - Popup 快速控制
const $ = (id) => document.getElementById(id);
const hasChrome = typeof chrome !== 'undefined' && !!chrome.runtime;

// 存储兼容：扩展内用 chrome.storage.sync，普通浏览器预览时降级到 localStorage
const store =
  hasChrome && chrome.storage && chrome.storage.sync
    ? chrome.storage.sync
    : (() => {
        let mem = {};
        try { mem = JSON.parse(localStorage.getItem('bt_popup') || '{}'); } catch (e) {}
        return {
          get(keys, cb) {
            const out = {};
            const list = Array.isArray(keys) ? keys : Object.keys(mem);
            list.forEach((k) => { if (k in mem) out[k] = mem[k]; });
            cb(out);
          },
          set(obj, cb) {
            Object.assign(mem, obj);
            try { localStorage.setItem('bt_popup', JSON.stringify(mem)); } catch (e) {}
            cb && cb();
          }
        };
      })();

store.get(['autoTranslate', 'sourceLang', 'targetLang', 'model'], (c) => {
  $('toggle').checked = c.autoTranslate !== false;
  $('sourceLang').value = c.sourceLang || 'auto';
  $('targetLang').value = c.targetLang || 'zh-CN';
  $('modelBadge').textContent = c.model || '未知模型';

  // 动态版本号，和 manifest.json 保持一致
  if (hasChrome && chrome.runtime && chrome.runtime.getManifest) {
    $('version').textContent = 'v' + chrome.runtime.getManifest().version;
  } else {
    $('version').textContent = 'v0.0.0';
  }
});

function activeTab(cb) {
  if (!hasChrome) { cb(null); return; }
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) cb(tabs[0].id);
  });
}

function safeSendTabMessage(tabId, msg, cb) {
  if (!hasChrome || tabId == null) {
    cb && cb({ ok: false, error: 'No extension context' });
    return;
  }
  try {
    chrome.tabs.sendMessage(tabId, msg, (resp) => {
      if (chrome.runtime.lastError) {
        // 静默失败：通常是 Edge 自身页面（edge://、chrome://、about:、PDF 等）
        // 这些页面不允许注入 content script，必然失败，是预期行为。
        // 上版用 console.warn 会让 Edge 把扩展标记为'有问题'，已改为静默。
        cb && cb({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      cb && cb(resp);
    });
  } catch (e) {
    cb && cb({ ok: false, error: e.message });
  }
}

function safeSendRuntimeMessage(msg, cb) {
  if (!hasChrome) {
    cb && cb({ ok: false, error: 'No extension context' });
    return;
  }
  try {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) {
        console.warn('[双语翻译]', chrome.runtime.lastError.message);
        cb && cb({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      cb && cb(resp);
    });
  } catch (e) {
    cb && cb({ ok: false, error: e.message });
  }
}

function refreshCacheStat() {
  if (!hasChrome) {
    $('cacheStat').textContent = '预览模式（无缓存）';
    return;
  }
  safeSendRuntimeMessage({ type: 'getCacheStats' }, (stat) => {
    if (!stat || typeof stat.urls !== 'number') {
      $('cacheStat').textContent = '无法读取缓存统计';
      return;
    }
    $('cacheStat').textContent = `已缓存 ${stat.urls} 个网页，共 ${stat.entries} 条译文`;
  });
}

$('toggle').addEventListener('change', (e) => {
  const v = e.target.checked;
  store.set({ autoTranslate: v });
  activeTab((tabId) => { if (tabId != null) safeSendTabMessage(tabId, { type: 'toggle', value: v }); });
});

// 公共后缀（Public Suffix）精简列表：
// github.io / co.uk / com.cn 等本身不是站点主域，取最后两级会解析错
const PUBLIC_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'net.uk', 'ltd.uk', 'plc.uk',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'ac.cn',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp',
  'com.br', 'net.br', 'org.br', 'gov.br', 'edu.br',
  'com.mx', 'org.mx', 'net.mx', 'edu.mx',
  'com.tw', 'org.tw', 'net.tw', 'edu.tw', 'gov.tw', 'idv.tw',
  'co.in', 'net.in', 'org.in', 'ac.in', 'gov.in', 'edu.in',
  'co.kr', 'or.kr', 'ne.kr', 'ac.kr', 'go.kr', 're.kr',
  'com.sg', 'net.sg', 'org.sg', 'edu.sg', 'gov.sg',
  'com.hk', 'net.hk', 'org.hk', 'edu.hk', 'gov.hk',
  'com.my', 'net.my', 'org.my', 'edu.my', 'gov.my',
  'co.nz', 'net.nz', 'org.nz', 'ac.nz', 'govt.nz',
  'co.za', 'org.za', 'net.za', 'gov.za', 'ac.za',
  'github.io', 'githubusercontent.com', 'gitlab.io', 'pages.dev', 'vercel.app',
  'netlify.app', 'surge.sh', 'firebaseapp.com', 'web.app', 'onrender.com',
  'repl.co', 'glitch.me', 'herokuapp.com', 'azurewebsites.net',
  'appspot.com', '000webhostapp.com', 'infinityfreeapp.com'
]);

// 归一化 host：普通域名提取主域名（news.medium.com → medium.com）
// 公共后缀域名保留两级以上（myuser.github.io → myuser.github.io）
// localhost / IP（含端口）保留完整 host（localhost:8137 独立生效）
// 与 content.js 的 normalizeHost 保持一致，保证存储与匹配一致
function normalizeHost(host) {
  let h = (host || '').replace(/^www\./, '').toLowerCase();
  const hostOnly = h.split(':')[0];
  if (hostOnly === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(hostOnly)) return h;
  const parts = hostOnly.split('.');
  if (parts.length > 2) {
    // 找"公共后缀"占了几个段：
    //   medium.com            → 后缀 1 段(com)   → 主域 medium.com
    //   news.medium.com       → 后缀 1 段(com)   → 主域 medium.com
    //   myuser.github.io      → 后缀 2 段(github.io) → 主域 myuser.github.io
    //   example.co.uk         → 后缀 2 段(co.uk) → 主域 example.co.uk
    //   shop.example.com.cn   → 后缀 2 段(com.cn) → 主域 example.com.cn
    let suffixLen = 1;
    if (PUBLIC_SUFFIXES.has(parts.slice(-2).join('.'))) suffixLen = 2;
    // 主域 = 后缀前一级 + 后缀（至少两段）
    h = parts.slice(-suffixLen - 1).join('.');
  }
  return h;
}

// 从 tab.url 解析 host（含端口），归一化到主域名
function hostOfTab(tab) {
  if (!tab || !tab.url) return null;
  try { return normalizeHost(new URL(tab.url).host); } catch (e) { return null; }
}

// 当前 tab 是否支持注入 content script（基于 URL 协议判断）
// chrome:// / edge:// / about: / 扩展自己的页等不允许注入
function isUnsupportedPage(tab) {
  const u = (tab && tab.url) || '';
  return /^(chrome|edge|about|chrome-extension|chrome-search|devtools|view-source):/i.test(u);
}

// 初始化「不翻译该网页」开关：显示当前域名，状态从 storage 判断
function initSiteBlock() {
  if (!hasChrome) return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    const host = hostOfTab(tab);
    if (!host) return;
    $('siteName').textContent = host;
    store.get(['blockedSites'], (c) => {
      const blocked = Array.isArray(c.blockedSites) ? c.blockedSites : [];
      $('siteBlock').checked = blocked.some((s) => host === normalizeHost(s));
    });
  });
}
initSiteBlock();

// 检测当前 tab 是否支持翻译，必要时禁用按钮 + 显示提示
function checkPageSupport() {
  if (!hasChrome) return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || isUnsupportedPage(tab)) {
      // 显示提示，禁用需要 content script 的按钮
      $('siteName').textContent = '当前页面不支持翻译';
      $('siteBlock').disabled = true;
      $('toggle').disabled = true;
      $('retranslate').disabled = true;
      $('remove').disabled = true;
      // 语言选择可以保留（用于设置页时仍可改默认语言，但重翻会失败——也禁）
      $('sourceLang').disabled = true;
      $('targetLang').disabled = true;
    }
  });
}
checkPageSupport();

// 切换「不翻译该网页」：更新 blockedSites + 通知当前页即时生效
$('siteBlock').addEventListener('change', (e) => {
  const on = e.target.checked;
  if (!hasChrome) return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    const host = hostOfTab(tab);
    if (!host || tab.id == null) return;
    store.get(['blockedSites'], (c) => {
      const blocked = Array.isArray(c.blockedSites) ? c.blockedSites.slice() : [];
      const idx = blocked.findIndex((s) => host === normalizeHost(s));
      if (on && idx === -1) blocked.push(host);
      if (!on && idx !== -1) blocked.splice(idx, 1);
      store.set({ blockedSites: blocked }, () => {
        safeSendTabMessage(tab.id, { type: 'siteBlock', blockedSites: blocked });
      });
    });
  });
});

// 语言切换：保存并触发重翻
function onLangChange() {
  const sourceLang = $('sourceLang').value;
  const targetLang = $('targetLang').value;
  store.set({ sourceLang, targetLang });
  activeTab((tabId) => {
    if (tabId == null) return;
    safeSendTabMessage(tabId, { type: 'langChange', sourceLang, targetLang });
    safeSendTabMessage(tabId, { type: 'remove' });
    safeSendTabMessage(tabId, { type: 'rerun' });
  });
}
$('sourceLang').addEventListener('change', onLangChange);
$('targetLang').addEventListener('change', onLangChange);

$('retranslate').addEventListener('click', () => {
  activeTab((tabId) => {
    if (tabId == null) return;
    safeSendTabMessage(tabId, { type: 'rerun' });
  });
});

$('remove').addEventListener('click', () => {
  activeTab((tabId) => { if (tabId != null) safeSendTabMessage(tabId, { type: 'remove' }); });
});

$('clearPage').addEventListener('click', () => {
  if (!hasChrome) { refreshCacheStat(); return; }
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab) return;
    safeSendRuntimeMessage({ type: 'clearCache', url: tab.url }, () => refreshCacheStat());
  });
});

$('clearAll').addEventListener('click', () => {
  if (!hasChrome) return;
  if (!confirm('确定清除所有翻译缓存？之后访问这些网页会重新调用 API。')) return;
  safeSendRuntimeMessage({ type: 'clearCache', url: null }, () => refreshCacheStat());
});

$('options').addEventListener('click', (e) => {
  e.preventDefault();
  if (hasChrome) chrome.runtime.openOptionsPage();
});

// 监听存储变化（来自设置页的改动），同步 UI
function bindStorageSync() {
  if (!hasChrome) return;
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      if (changes.autoTranslate) $('toggle').checked = changes.autoTranslate.newValue !== false;
      if (changes.model) $('modelBadge').textContent = changes.model.newValue || '未知模型';
    });
  } catch (e) { console.warn(e.message); }
}
bindStorageSync();

refreshCacheStat();

// ====== 错误提醒 ======

// 将 API 错误码/原文映射为用户友好的中文提示
function friendlyMsg(raw) {
  const m = (raw || '').toLowerCase();
  if (m.includes('401') || m.includes('unauthorized') || m.includes('invalid api key') || m.includes('authentication'))
    return 'API Key 无效或已过期，请点击右下角齿轮图标前往设置页面，检查并更新 API Key';
  if (m.includes('403') || m.includes('forbidden'))
    return 'API 权限不足，请检查 API Key 是否有权限调用该模型，或确认账户余额是否充足';
  if (m.includes('429') || m.includes('rate limit') || m.includes('too many'))
    return 'API 请求频率过高被限流，请稍等片刻后刷新页面重试';
  if (m.includes('500') || m.includes('502') || m.includes('503') || m.includes('server error'))
    return '翻译服务暂时不可用，可能是模型服务商故障，请稍后重试';
  if (m.includes('未配置') || m.includes('no api key') || m.includes('未填写'))
    return '尚未配置 API Key，请点击右下角齿轮图标前往设置页面填写';
  if (m.includes('timeout') || m.includes('超时'))
    return '翻译请求超时，请检查网络连接后刷新页面重试';
  if (m.includes('network') || m.includes('fetch') || m.includes('failed to fetch'))
    return '网络连接异常，请检查网络后刷新页面重试';
  const short = raw.length > 80 ? raw.slice(0, 80) + '…' : raw;
  return '翻译时出现异常：' + short + ' ，可尝试刷新页面或检查设置';
}

function showError(raw) {
  if (!raw) return;
  $('errorText').textContent = friendlyMsg(raw);
  $('errorBanner').classList.add('show');
}

function clearError() {
  $('errorBanner').classList.remove('show');
  if (hasChrome) {
    try { chrome.storage.local.remove('lastError'); } catch (e) {}
  }
}

$('errorClose').addEventListener('click', clearError);

function checkLastError() {
  if (!hasChrome) return;
  try {
    chrome.storage.local.get('lastError', (c) => {
      if (!c.lastError || !c.lastError.message) return;
      if (Date.now() - c.lastError.ts > 30 * 60 * 1000) {
        chrome.storage.local.remove('lastError');
        return;
      }
      showError(c.lastError.message);
    });
  } catch (e) {}
}
checkLastError();

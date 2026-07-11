// bookmarklet.js — 由书签加载到目标页面，执行翻译
// 所有逻辑定义在 IIFE 内，不污染全局

(function() {
  // ── 自动探测 API 地址 ─────────────────
  // 根据 bookmarklet.js 自身的加载地址推断 API 根路径
  const SCRIPTS = document.querySelectorAll('script[src*="bookmarklet.js"]');
  const API_BASE = SCRIPTS.length > 0
    ? SCRIPTS[SCRIPTS.length - 1].src.replace(/\/bookmarklet\.js.*$/, '')
    : 'http://localhost:3000';
  const STORAGE_KEY = 'bt_api_config';

  // ── 存储 ───────────────────────────────
  function loadConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function saveConfig(cfg) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  }

  // ── 语言映射 ──────────────────────────
  const LANG_MAP = {
    'ko': '韩语', 'ja': '日语', 'zh-CN': '中文',
    'en': '英语', 'es': '西班牙语', 'de': '德语', 'fr': '法语'
  };

  // ── 收集页面文本 ──────────────────────
  function collectTexts() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const v = n.nodeValue.trim();
        if (!v || v.length < 4) return NodeFilter.FILTER_REJECT;
        const p = n.parentElement;
        if (!p || ['SCRIPT','STYLE','NOSCRIPT','TEXTAREA','INPUT','CODE','PRE','SVG'].includes(p.tagName))
          return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    return nodes;
  }

  // ── 批量翻译 ──────────────────────────
  async function translate(config, texts) {
    const resp = await fetch(`${API_BASE}/api/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: texts.join('\n---BT_SEP---\n'),
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.model,
        sourceLang: config.sourceLang || 'auto',
        targetLang: config.targetLang || 'zh-CN'
      })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || '翻译失败');
    return data.translation.split('\n---BT_SEP---\n');
  }

  // ── 弹出配置面板 ──────────────────────
  function showConfigPanel(current, onSave) {
    const mask = document.createElement('div');
    mask.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:99999;display:flex;align-items:center;justify-content:center;';
    const panel = document.createElement('div');
    panel.style.cssText = 'background:#fff;border-radius:16px;padding:28px;width:340px;max-width:90vw;box-shadow:0 8px 40px rgba(0,0,0,0.3);font-family:-apple-system,sans-serif;font-size:14px;color:#222;';
    panel.innerHTML = `
      <h2 style="margin:0 0 18px;font-size:18px;">翻译设置</h2>
      <label style="display:block;margin-bottom:6px;font-weight:600;">API Base URL</label>
      <input id="bt-url" value="${current?.baseUrl || 'https://api.deepseek.com/v1'}" style="width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:10px;font-size:14px;margin-bottom:12px;box-sizing:border-box;">
      <label style="display:block;margin-bottom:6px;font-weight:600;">API Key</label>
      <input id="bt-key" type="password" value="${current?.apiKey || ''}" style="width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:10px;font-size:14px;margin-bottom:12px;box-sizing:border-box;">
      <label style="display:block;margin-bottom:6px;font-weight:600;">Model</label>
      <input id="bt-model" value="${current?.model || 'deepseek-chat'}" style="width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:10px;font-size:14px;margin-bottom:16px;box-sizing:border-box;">
      <div style="display:flex;gap:10px;">
        <button id="bt-cancel" style="flex:1;padding:10px;border:1px solid #ddd;border-radius:10px;background:#fff;font-size:14px;cursor:pointer;">取消</button>
        <button id="bt-save" style="flex:1;padding:10px;border:none;border-radius:10px;background:#4f46e5;color:#fff;font-size:14px;font-weight:600;cursor:pointer;">保存并翻译</button>
      </div>
    `;
    mask.appendChild(panel);
    document.body.appendChild(mask);

    panel.querySelector('#bt-cancel').onclick = () => mask.remove();
    panel.querySelector('#bt-save').onclick = () => {
      const cfg = {
        apiKey: panel.querySelector('#bt-key').value.trim(),
        baseUrl: panel.querySelector('#bt-url').value.trim(),
        model: panel.querySelector('#bt-model').value.trim(),
        sourceLang: current?.sourceLang || 'auto',
        targetLang: current?.targetLang || 'zh-CN'
      };
      if (!cfg.apiKey) { alert('请输入 API Key'); return; }
      saveConfig(cfg);
      mask.remove();
      onSave(cfg);
    };
  }

  // ── 渲染译文 ──────────────────────────
  function renderTranslations(nodes, translations) {
    const style = document.createElement('style');
    style.textContent = `
      .bt-orig { display:block; }
      .bt-trans { display:block;margin-top:2px;padding:2px 6px;border-left:3px solid rgba(79,70,229,0.4);background:rgba(99,102,241,0.06);border-radius:4px;color:#6b7280;font-size:0.92em;line-height:1.6; }
    `;
    document.head.appendChild(style);

    // 先给所有节点加翻译后，再按顺序组织
    const batch = [];
    nodes.forEach((node, i) => {
      const zh = translations[i];
      if (!zh) return;
      
      const parent = node.parentElement;
      if (!parent) return;

      const orig = document.createElement('span');
      orig.className = 'bt-orig';
      parent.insertBefore(orig, node);
      orig.appendChild(node);

      const span = document.createElement('span');
      span.className = 'bt-trans';
      span.textContent = zh;
      parent.insertBefore(span, orig.nextSibling);
    });
  }

  // ── 主流程 ──────────────────────────────
  async function main() {
    // 1. 加载配置
    let config = loadConfig();

    // 2. 如果没有 API Key，弹出配置面板
    if (!config || !config.apiKey) {
      showConfigPanel(config, async (cfg) => {
        config = cfg;
        await doTranslate(config);
      });
      return;
    }

    // 3. 直接翻译
    await doTranslate(config);
  }

  async function doTranslate(config) {
    const nodes = collectTexts();
    if (!nodes.length) { alert('未检测到可翻译的文本'); return; }

    const texts = nodes.map(n => n.nodeValue.trim());
    
    // 显示加载提示
    const toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;top:20px;right:20px;background:#4f46e5;color:#fff;padding:12px 20px;border-radius:12px;font-size:14px;z-index:99999;box-shadow:0 4px 16px rgba(0,0,0,0.3);';
    toast.textContent = '翻译中…';
    document.body.appendChild(toast);

    try {
      const translations = await translate(config, texts);
      renderTranslations(nodes, translations);
      toast.textContent = `✅ 翻译完成 (${translations.length} 段)`;
      setTimeout(() => toast.remove(), 2000);
    } catch (e) {
      toast.textContent = '❌ ' + e.message;
      toast.style.background = '#dc2626';
      setTimeout(() => toast.remove(), 3000);
    }
  }

  // ── 启动 ──────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
  } else {
    main();
  }
})();

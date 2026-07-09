// 双语 AI 翻译 - Options 页逻辑
const $ = (id) => document.getElementById(id);

const PRESETS = {
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', keyField: 'apiKey_deepseek' },
  qwen:     { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', keyField: 'apiKey_qwen' },
  glm:      { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-plus', keyField: 'apiKey_glm' }
};

const KEY_FIELDS = Object.values(PRESETS).map(p => p.keyField);
const fields = ['baseUrl', 'apiKey', 'model', 'autoTranslate', 'mode', 'zhColor', 'sourceLang', 'targetLang', ...KEY_FIELDS];

const DEFAULTS = {
  baseUrl: PRESETS.deepseek.baseUrl,
  model: PRESETS.deepseek.model,
  apiKey: '' // DeepSeek 默认 key 为空，由用户自行填写
};

// 存储兼容：扩展内用 chrome.storage.sync，普通浏览器预览时降级到 localStorage
const store =
  typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync
    ? chrome.storage.sync
    : (() => {
        let mem = {};
        try { mem = JSON.parse(localStorage.getItem('bt_opts') || '{}'); } catch (e) {}
        return {
          get(keys, cb) {
            const out = {};
            const list = Array.isArray(keys) ? keys : Object.keys(mem);
            list.forEach((k) => { if (k in mem) out[k] = mem[k]; });
            cb(out);
          },
          set(obj, cb) {
            Object.assign(mem, obj);
            try { localStorage.setItem('bt_opts', JSON.stringify(mem)); } catch (e) {}
            cb && cb();
          }
        };
      })();

// 根据 baseUrl 找到对应的 keyField
function keyFieldFor(baseUrl) {
  const u = (baseUrl || '').replace(/\/+$/, '');
  for (const key of Object.keys(PRESETS)) {
    if (PRESETS[key].baseUrl.replace(/\/+$/, '') === u) return PRESETS[key].keyField;
  }
  return 'apiKey';
}

function getCurrentKeyField() {
  return keyFieldFor($('baseUrl').value);
}

function syncPresetHighlight() {
  const u = ($('baseUrl').value || '').replace(/\/+$/, '');
  document.querySelectorAll('.preset-pill').forEach((btn) => {
    const hit = btn.dataset.u.replace(/\/+$/, '') === u;
    btn.classList.toggle('active', hit);
  });
}

// 迁移旧版单 key 到新版分模型 key（只执行一次）
function migrateOldKey(c) {
  if (c.apiKey && !c.apiKey_deepseek && !c.apiKey_qwen && !c.apiKey_glm) {
    const field = keyFieldFor(c.baseUrl || DEFAULTS.baseUrl);
    return { [field]: c.apiKey };
  }
  return null;
}

store.get(fields, (c) => {
  const baseUrl = c.baseUrl || DEFAULTS.baseUrl;
  const model = c.model || DEFAULTS.model;

  // 首次使用或旧版数据：写入默认配置并迁移 key
  const migration = migrateOldKey(c);
  const firstUse = !c.baseUrl && !c.model && !c.apiKey;
  if (firstUse || migration) {
    const keyField = keyFieldFor(baseUrl);
    const initData = {
      baseUrl,
      model,
      autoTranslate: true,
      mode: 'bilingual',
      zhColor: '#6b7280',
      [keyField]: migration ? migration[keyField] : DEFAULTS.apiKey
    };
    store.set(initData);
  }

  const keyField = keyFieldFor(baseUrl);
  let apiKey = c[keyField] || '';
  // 迁移立即在 UI 生效（chrome.storage.set 是异步，c 对象里还没有新 key）
  if (!apiKey && migration && migration[keyField]) apiKey = migration[keyField];

  $('baseUrl').value = baseUrl;
  $('apiKey').value = apiKey;
  $('model').value = model;
  $('autoTranslate').checked = c.autoTranslate !== false;
  $('mode').value = c.mode || 'bilingual';
  $('sourceLang').value = c.sourceLang || 'auto';
  $('targetLang').value = c.targetLang || 'zh-CN';
  $('zhColor').value = c.zhColor || DEFAULT_ZH_COLOR;
  $('zhColorVal').textContent = c.zhColor || DEFAULT_ZH_COLOR;
  toggleResetColorBtn();
  syncPresetHighlight();
});

// 预设 pills：点击自动填充 Base URL / 模型名 / 对应 apiKey
function saveCurrentKey() {
  const currentKeyField = getCurrentKeyField();
  store.set({ [currentKeyField]: $('apiKey').value.trim() });
}

document.querySelectorAll('.preset-pill').forEach((btn) => {
  btn.addEventListener('click', () => {
    saveCurrentKey(); // 先把当前 key 存到当前模型
    const key = btn.dataset.key;
    const preset = PRESETS[key];
    store.get([preset.keyField], (c) => {
      $('model').value = preset.model;
      $('baseUrl').value = preset.baseUrl;
      $('apiKey').value = c[preset.keyField] || '';
      syncPresetHighlight();
    });
  });
});

// 手动修改模型/URL 时取消预设高亮
$('model').addEventListener('input', syncPresetHighlight);
$('baseUrl').addEventListener('input', syncPresetHighlight);

// 译文颜色实时显示
const DEFAULT_ZH_COLOR = '#6b7280';

function toggleResetColorBtn() {
  const current = $('zhColor').value;
  $('resetColor').classList.toggle('show', current !== DEFAULT_ZH_COLOR);
}

$('zhColor').addEventListener('input', (e) => {
  $('zhColorVal').textContent = e.target.value;
  toggleResetColorBtn();
});

$('resetColor').addEventListener('click', () => {
  $('zhColor').value = DEFAULT_ZH_COLOR;
  $('zhColorVal').textContent = DEFAULT_ZH_COLOR;
  toggleResetColorBtn();
});

// API Key 显示/隐藏切换
const eyeOpen = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>';
const eyeClosed = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>';
$('toggleEye').addEventListener('click', () => {
  const input = $('apiKey');
  const icon = $('eyeIcon');
  if (input.type === 'password') {
    input.type = 'text';
    icon.innerHTML = eyeClosed;
    $('toggleEye').title = '隐藏';
  } else {
    input.type = 'password';
    icon.innerHTML = eyeOpen;
    $('toggleEye').title = '显示';
  }
});

$('save').addEventListener('click', () => {
  // 非空校验
  const baseUrl = $('baseUrl').value.trim();
  const apiKey = $('apiKey').value.trim();
  let hasError = false;

  // 校验 API Base URL
  if (!baseUrl) {
    $('baseUrl').classList.add('input-error');
    $('baseUrlError').textContent = '请输入 API Base URL';
    $('baseUrlError').classList.add('show');
    hasError = true;
  }

  // 校验 API Key
  if (!apiKey) {
    $('apiKey').classList.add('input-error');
    $('apiKeyError').textContent = '请输入 API Key';
    $('apiKeyError').classList.add('show');
    hasError = true;
  }

  // 校验模型名称
  const model = $('model').value.trim();
  if (!model) {
    $('model').classList.add('input-error');
    $('modelError').textContent = '请输入模型名称';
    $('modelError').classList.add('show');
    hasError = true;
  }

  if (hasError) return;

  const keyField = getCurrentKeyField();
  const data = {
    baseUrl,
    model,
    [keyField]: apiKey,
    autoTranslate: $('autoTranslate').checked,
    mode: $('mode').value,
    sourceLang: $('sourceLang').value,
    targetLang: $('targetLang').value,
    zhColor: $('zhColor').value
  };
  store.set(data, () => {
    const s = $('status');
    s.classList.add('show');
    setTimeout(() => s.classList.remove('show'), 2000);
  });
});

// 输入时清除错误状态
$('baseUrl').addEventListener('input', () => {
  $('baseUrl').classList.remove('input-error');
  $('baseUrlError').classList.remove('show');
});
$('apiKey').addEventListener('input', () => {
  $('apiKey').classList.remove('input-error');
  $('apiKeyError').classList.remove('show');
});
$('model').addEventListener('input', () => {
  $('model').classList.remove('input-error');
  $('modelError').classList.remove('show');
});

// 监听来自 popup 或其他入口的自动翻译变化，同步 UI
(function () {
  if (typeof chrome === 'undefined' || !chrome.storage) return;
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync' || !changes.autoTranslate) return;
      $('autoTranslate').checked = changes.autoTranslate.newValue !== false;
    });
  } catch (e) { console.warn(e.message); }
})();

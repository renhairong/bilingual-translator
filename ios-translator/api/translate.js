// Vercel Serverless Function — 翻译中转 API
// 书签脚本把文本发到这里，再转发到 AI 接口，绕过 CORS 限制

export default async function handler(req, res) {
  // 只接受 POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { text, apiKey, baseUrl, model, sourceLang, targetLang } = req.body;

  // 必填校验
  if (!text || !apiKey || !baseUrl || !model) {
    return res.status(400).json({ error: 'Missing required fields: text, apiKey, baseUrl, model' });
  }

  // 清理 baseUrl
  const base = baseUrl.replace(/\/+$/, '');
  const url = `${base}/chat/completions`;

  // 拼接系统提示词
  const src = sourceLang === 'auto' ? '源语言' : sourceLang;
  const tgt = targetLang || '简体中文';
  const systemPrompt = `你是一个专业翻译。将用户提供的文本从${src}翻译成${tgt}。只返回译文，不要加任何解释。` +
    (targetLang === 'zh-CN' ? '注意：如果原文是中文，直接返回原文。' : '');

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text }
        ],
        temperature: 0.3,
        max_tokens: 4096
      })
    });

    if (!resp.ok) {
      const err = await resp.text();
      return res.status(resp.status).json({ error: `AI API error: ${err}` });
    }

    const data = await resp.json();
    const translation = data.choices?.[0]?.message?.content?.trim() || '';

    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json({ translation });

  } catch (e) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(500).json({ error: e.message });
  }
}

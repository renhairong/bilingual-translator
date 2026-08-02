# Edge 扩展认证说明

## 测试账号
无需账号/登录，扩展不包含任何付费功能，完全免费使用。

## 使用前配置
扩展翻译功能依赖第三方 AI API（用户自备），需先完成配置：
1. 右键扩展图标 → 选项（Options）
2. 填写 API Base URL（默认已填 DeepSeek）
3. 填写 API Key（用户自己的 Key）
4. 选择模型名称
5. 点击「保存设置」

推荐免费 API：DeepSeek（api.deepseek.com）、阿里 Qwen、智谱 GLM 等。

## 功能测试步骤
1. 打开 `options.html` 配置页，填入 API Key 并保存
2. 打开任意英文网页（如 https://www.bbc.com/news）
3. 扩展会自动将英文段落翻译为中文，原文在上、译文在下双语对照
4. 点击扩展图标可切换「自动翻译」开关
5. options 页支持切换「仅显示译文」模式、自定义文字颜色等

## 隐私说明
- API Key 仅保存在用户本地浏览器（chrome.storage.sync）
- 翻译文本直接发送到用户配置的第三方 API 服务
- 扩展不收集任何用户数据

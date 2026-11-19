import type { AiChatMessage, AiChatRequest, AiChatResult, AiConfig, AiTestResult } from '../src/types';
import { normalizeAiConfig, normalizeChatEndpoint } from '../src/lib/ai';
import { fetchText } from './net';

const CHAT_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 30_000;
const MAX_MESSAGES = 20;
const MAX_CONTENT = 8000;

function short(text: string, limit = 320): string {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function providerError(text: string): string {
  try {
    const data = JSON.parse(text);
    const message = data?.error?.message || data?.message || data?.error?.code;
    if (typeof message === 'string' && message.trim()) return short(message);
  } catch {
    /* 非 JSON 错误体 */
  }
  return short(text, 180);
}

function statusError(status: number, text: string): string {
  const detail = providerError(text);
  if (status === 401 || status === 403) {
    return '鉴权失败：请检查 API Key 是否正确，以及该密钥是否有此模型的权限';
  }
  if (status === 404) {
    return '接口地址不存在：请检查 API 地址（可填写根地址、/v1 或完整的 /chat/completions）';
  }
  if (status === 429) {
    return detail ? `请求过于频繁或额度不足：${detail}` : '请求过于频繁或额度不足，请稍后重试';
  }
  if (status >= 500) return `模型供应商暂时不可用（HTTP ${status}）` + (detail ? `：${detail}` : '');
  if (status === 400) return detail ? `请求被供应商拒绝：${detail}` : '请求被供应商拒绝，请检查模型名称与参数';
  return `接口返回 HTTP ${status}` + (detail ? `：${detail}` : '');
}

function contentOf(data: any): string {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part: any) => {
        if (typeof part === 'string') return part;
        if (typeof part?.text === 'string') return part.text;
        return '';
      })
      .join('');
  }
  if (typeof data?.choices?.[0]?.text === 'string') return data.choices[0].text;
  return '';
}

async function requestChat(
  config: AiConfig,
  messages: AiChatMessage[],
  maxTokens: number,
  timeoutMs: number
): Promise<AiChatResult> {
  let normalized: AiConfig;
  try {
    normalized = normalizeAiConfig(config);
  } catch (err: any) {
    return { ok: false, error: err?.message || 'AI 配置不完整' };
  }

  let endpoint: string;
  try {
    endpoint = normalizeChatEndpoint(normalized.baseUrl);
  } catch (err: any) {
    return { ok: false, error: err?.message || 'API 地址不正确' };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (normalized.apiKey) headers.Authorization = `Bearer ${normalized.apiKey}`;

  const body = JSON.stringify({
    model: normalized.model,
    messages,
    temperature: 0.1,
    max_tokens: maxTokens,
    stream: false,
  });

  const res = await fetchText(endpoint, {
    method: 'POST',
    headers,
    body,
    timeoutMs,
  });
  if (!res.ok) {
    if (res.status === 0) {
      return { ok: false, error: `无法连接模型供应商：${res.error || '网络请求失败'}`, ms: res.ms };
    }
    return { ok: false, error: statusError(res.status, res.text), ms: res.ms, model: normalized.model };
  }

  let data: any;
  try {
    data = JSON.parse(res.text);
  } catch {
    return { ok: false, error: '模型接口返回的不是 JSON，请确认地址是 OpenAI 兼容接口', ms: res.ms, model: normalized.model };
  }
  if (data?.error) {
    const detail = data.error?.message || data.error?.code;
    return {
      ok: false,
      error: detail ? short(String(detail)) : '模型供应商返回错误',
      ms: res.ms,
      model: normalized.model,
    };
  }
  const content = contentOf(data);
  if (!content.trim()) {
    return { ok: false, error: '模型返回了空内容，请稍后重试或更换模型', ms: res.ms, model: normalized.model };
  }
  return {
    ok: true,
    content: content.slice(0, 20_000),
    ms: res.ms,
    model: typeof data?.model === 'string' ? data.model : normalized.model,
  };
}

function cleanMessages(messages: AiChatMessage[]): AiChatMessage[] {
  return messages
    .filter((m) => m && (m.role === 'system' || m.role === 'user' || m.role === 'assistant'))
    .filter((m) => typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CONTENT) }));
}

/** 主进程调用 OpenAI 兼容的 chat/completions，密钥不经过渲染层网络栈 */
export async function chatCompletion(req: AiChatRequest, fallback?: Partial<AiConfig>): Promise<AiChatResult> {
  if (!req || !Array.isArray(req.messages)) return { ok: false, error: '请求格式不正确' };
  const messages = cleanMessages(req.messages);
  if (messages.length === 0) return { ok: false, error: '请输入你想找的影片描述' };
  const config: Partial<AiConfig> = req.config || fallback || {};
  return requestChat(config as AiConfig, messages, 2000, CHAT_TIMEOUT_MS);
}

/** 测试连接：发一条极短的消息，验证地址、密钥与模型是否都可用 */
export async function testConnection(config?: Partial<AiConfig>): Promise<AiTestResult> {
  const result = await requestChat(
    (config || {}) as AiConfig,
    [
      { role: 'system', content: '你是连接测试助手，只回复 OK。' },
      { role: 'user', content: '只回复 OK' },
    ],
    16,
    TEST_TIMEOUT_MS
  );
  return { ok: result.ok, error: result.error, model: result.model, ms: result.ms };
}

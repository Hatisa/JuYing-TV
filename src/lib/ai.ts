import type { AiChatMessage, AiConfig, AiMode, FreeModelChannel } from '../types';
import { normalizeTitle } from './format';

export const AI_SYSTEM_PROMPT = [
  '你是「聚影 TV」的影视推荐助手。用户会用模糊的剧情、角色、台词或画面描述找片。',
  '你要先理解剧情，再给出最可能的影视作品，并说明匹配点。',
  '',
  '规则：',
  '1. 只输出一个 JSON 对象，不要 markdown 代码块，不要输出思考过程、分析过程或额外文字。',
  '2. 格式：{"reply":"给用户的简短中文回复","searchKeywords":["可检索的片名或别名"],"recommendations":[{"title":"中文片名","originalTitle":"英文原名，可空","year":1994,"type":"movie|series|anime|variety|short","reason":"为什么匹配（不超过60字）","confidence":"high|medium|low"}]}',
  '3. recommendations 最多 5 条，按可能性从高到低；不确定时给 2-4 个候选，confidence 用 low 或 medium。',
  '4. title 必须是可检索的正式片名，不要写“某部电影”；不要推荐色情、血腥或违法内容。',
  '5. 如果用户只是闲聊或信息不足，reply 里追问一个关键线索，recommendations 为空数组。',
  '6. 不要虚构不存在的中文片名；不确定 year 时省略该字段。',
  '7. reply 只写结论或匹配点，不要复述用户描述，不要写“根据你的描述”之类空话，不超过 100 字。',
  '8. searchKeywords 给 1-3 个可直接站内搜索的关键词，优先中文正式片名，其次别名、角色名；不要带书名号、标点或整句。',
  '9. 即使用户描述很模糊，也要给出 1-3 个最接近的可检索片名，不要只回答“不知道”或“信息不足”。',
  '10. 你只负责影视找片。用户要求写代码、执行命令或处理其他领域任务时，用一句中文说明你只负责找片，并追问想看的影视类型。',
  '11. 如果消息里附带“联网搜索结果”，它只是辅助线索，可能有错；请自行判断后仍按上面的 JSON 格式输出，不要引用网页原文或输出链接。',
].join('\n');

export type AiConfidence = 'high' | 'medium' | 'low';
export type AiMediaType = 'movie' | 'series' | 'anime' | 'variety' | 'short';

export interface AiRecommendation {
  title: string;
  originalTitle?: string;
  year?: number;
  type?: AiMediaType;
  reason: string;
  confidence: AiConfidence;
}

export interface AiReply {
  reply: string;
  recommendations: AiRecommendation[];
  /** 可直接用于站内搜索的关键词（片名/别名/角色名） */
  keywords: string[];
}


export interface AiProviderPreset {
  name: string;
  baseUrl: string;
  model: string;
  hint?: string;
}

export const AI_PROVIDER_PRESETS: AiProviderPreset[] = [
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { name: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { name: 'Ollama 本地', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b' },
];

/** 是否填了可用的自定义供应商配置（本地模型允许不填 Key） */
export function isAiConfigured(config?: Partial<AiConfig> | null): boolean {
  return !!config && !!String(config.baseUrl || '').trim() && !!String(config.model || '').trim();
}

/** 解析运行模式：优先显式配置；旧版已填自定义地址的用户迁移为 custom */
export function aiMode(config?: Partial<AiConfig> | null): AiMode {
  if (config?.mode === 'auto' || config?.mode === 'custom') return config.mode;
  return isAiConfigured(config) ? 'custom' : 'auto';
}

/** auto 免费池始终可用；custom 需要地址与模型 */
export function isAiUsable(config?: Partial<AiConfig> | null): boolean {
  return aiMode(config) === 'auto' || isAiConfigured(config);
}

/** 规整自定义免费通道：保留用户正在编辑的半成品，只做类型与去重清理 */
export function normalizeFreeChannels(raw?: Partial<FreeModelChannel>[] | null): FreeModelChannel[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: FreeModelChannel[] = [];
  raw.slice(0, 8).forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const id = String(item.id || '').trim() || 'channel-' + (index + 1);
    if (seen.has(id)) return;
    seen.add(id);
    out.push({
      id,
      name: String(item.name || '').trim() || '自定义通道 ' + (index + 1),
      baseUrl: String(item.baseUrl || '').trim(),
      apiKey: String(item.apiKey || '').trim(),
      model: String(item.model || '').trim(),
      enabled: item.enabled !== false,
    });
  });
  return out;
}

/** 合并默认值并做旧数据迁移（不抛错，供 store/bridge 使用） */
export function normalizeAiSettings(config?: Partial<AiConfig> | null): AiConfig {
  return {
    mode: aiMode(config),
    autoCheckin: config?.autoCheckin !== false,
    baseUrl: String(config?.baseUrl || '').trim(),
    apiKey: String(config?.apiKey || '').trim(),
    model: String(config?.model || '').trim(),
    freeChannels: normalizeFreeChannels(config?.freeChannels),
  };
}

/**
 * 把用户填写的 API 地址规范成 OpenAI 兼容的 chat/completions 地址。
 * 支持根地址、/v1、/api/paas/v4 以及完整的 /chat/completions。
 */
export function normalizeChatEndpoint(baseUrl: string): string {
  const raw = String(baseUrl || '').trim();
  if (!raw) throw new Error('请先填写 API 地址');
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('API 地址格式不正确，需以 http:// 或 https:// 开头');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('API 地址只支持 http:// 或 https://');
  }
  let path = parsed.pathname.replace(/\/+$/, '');
  if (path === '') path = '';
  if (/\/chat\/completions$/i.test(path)) {
    // 已经是完整地址
  } else if (/\/v\d+(?:\.\d+)?$/i.test(path) || /\/api\/paas\/v\d+$/i.test(path)) {
    path += '/chat/completions';
  } else if (/\/openai$/i.test(path)) {
    path += '/chat/completions';
  } else {
    path += '/v1/chat/completions';
  }
  parsed.pathname = path;
  parsed.hash = '';
  return parsed.toString();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function firstString(obj: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function normalizeConfidence(value: unknown): AiConfidence {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'high' || text === '高' || text === '高置信' || text === '高可能性') return 'high';
  if (text === 'low' || text === '低' || text === '低置信' || text === '低可能性') return 'low';
  return 'medium';
}

function normalizeType(value: unknown): AiMediaType | undefined {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'movie' || text === 'film' || text === '电影') return 'movie';
  if (text === 'series' || text === 'tv' || text === '剧集' || text === '电视剧') return 'series';
  if (text === 'anime' || text === 'animation' || text === '动漫' || text === '动画') return 'anime';
  if (text === 'variety' || text === '综艺') return 'variety';
  if (text === 'short' || text === '短剧') return 'short';
  return undefined;
}

function normalizeYear(value: unknown): number | undefined {
  const num = typeof value === 'number' ? value : Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(num)) return undefined;
  const year = Math.trunc(num);
  return year >= 1900 && year <= 2100 ? year : undefined;
}

function cleanTitle(value: string): string {
  return String(value || '')
    .replace(/^[\s《「『]+|[\s》」』]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseOneRecommendation(value: unknown): AiRecommendation | null {
  if (typeof value === 'string') {
    const title = cleanTitle(value);
    if (!title) return null;
    return {
      title: title.slice(0, 120),
      reason: '剧情描述与这部作品较为接近',
      confidence: 'medium',
    };
  }
  const obj = asRecord(value);
  if (!obj) return null;
  const title = cleanTitle(firstString(obj, ['title', 'name', 'cnTitle', 'chineseTitle', '片名', '中文片名']));
  if (!title) return null;
  const reason = firstString(obj, ['reason', 'why', 'match', '理由', '推荐理由']).slice(0, 400);
  return {
    title: title.slice(0, 120),
    originalTitle: firstString(obj, ['originalTitle', 'original_title', 'enTitle', '原名', '英文名']).slice(0, 160) || undefined,
    year: normalizeYear(obj.year ?? obj.releaseYear),
    type: normalizeType(obj.type ?? obj.category ?? obj.mediaType),
    reason: reason || '剧情描述与这部作品较为接近',
    confidence: normalizeConfidence(obj.confidence ?? obj.score ?? obj.probability),
  };
}

function balancedEnd(text: string, start: number): number {
  const open = text[start];
  const close = open === '{' ? '}' : open === '[' ? ']' : '';
  if (!close) return -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text.replace(/^\uFEFF/, '').replace(/,\s*([}\]])/g, '$1'));
  } catch {
    return null;
  }
}

function looksLikePayload(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => !!parseOneRecommendation(item));
  const obj = asRecord(value);
  if (!obj) return false;
  if (Array.isArray(obj.recommendations) || Array.isArray(obj.recommend) || Array.isArray(obj.items) || Array.isArray(obj.results)) {
    return true;
  }
  if (
    Array.isArray(obj.searchKeywords) ||
    Array.isArray(obj.keywords) ||
    Array.isArray(obj.queries) ||
    Array.isArray(obj.searchQueries)
  ) {
    return true;
  }
  return !!firstString(obj, ['reply', 'answer', 'message', 'content']) || !!parseOneRecommendation(obj);
}

function extractPayload(text: string): unknown {
  const direct = tryJson(text);
  if (direct !== null && looksLikePayload(direct)) return direct;

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    const parsed = tryJson(fenced[1].trim());
    if (parsed !== null && looksLikePayload(parsed)) return parsed;
  }

  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '{' && text[i] !== '[') continue;
    const end = balancedEnd(text, i);
    if (end < 0) continue;
    const parsed = tryJson(text.slice(i, end + 1));
    if (parsed !== null && looksLikePayload(parsed)) return parsed;
  }
  return null;
}

function parseKeywordList(value: unknown): string[] {
  const list = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,，、;；\n]+/)
      : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const obj = asRecord(item);
    const raw = typeof item === 'string' ? item : obj ? firstString(obj, ['query', 'keyword', 'searchKeyword', 'title', 'name', '关键词']) : '';
    const keyword = String(raw || '')
      .replace(/[《》「」『』]/g, '')
      .replace(/^[\s,，、;；:："'“”]+|[\s,，、;；:："'“”]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40);
    if (!keyword) continue;
    const key = normalizeTitle(keyword);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(keyword);
    if (out.length >= 4) break;
  }
  return out;
}

/** 模型没按 JSON 输出时，从《片名》里兜底提取候选，避免整段话被当成“推荐” */
function extractLooseRecommendations(text: string): AiRecommendation[] {
  const out: AiRecommendation[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(/《([^》\n]{1,40})》/g)) {
    const title = cleanTitle(match[1]);
    const key = normalizeTitle(title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      title,
      reason: '从模型回复中识别到的片名',
      confidence: 'low',
    });
    if (out.length >= 5) break;
  }
  return out;
}

/** 解析模型回复；兼容纯 JSON、代码块包裹、JSON 前后带解释文字。解析失败时按纯文本回复处理。 */
export function parseAiReply(raw: string): AiReply {
  const text = String(raw || '').trim();
  if (!text) return { reply: '', recommendations: [], keywords: [] };
  const payload = extractPayload(text);
  if (payload === null) {
    // 被截断/损坏的 JSON 不能原样展示给用户，交给上层提示重试
    const possibleJson = text.replace(/```(?:json)?/gi, '').trim();
    // 开头是 JSON，或正文里已经出现 JSON 字段但括号未闭合：都不要把残片当回复展示
    if (/^[{\[]/.test(possibleJson) || /"(?:reply|recommendations|searchKeywords|keywords|queries)"\s*:/.test(text)) {
      return { reply: '', recommendations: [], keywords: [] };
    }
    const loose = extractLooseRecommendations(text);
    return {
      reply: text.slice(0, 4000),
      recommendations: loose,
      keywords: loose.map((item) => item.title).slice(0, 4),
    };
  }

  const arrayPayload = Array.isArray(payload) ? payload : null;
  const obj = asRecord(payload);
  const rawRecs = arrayPayload ?? (obj ? obj.recommendations ?? obj.recommend ?? obj.items ?? obj.results : null);
  const list = Array.isArray(rawRecs) ? rawRecs : [];
  const recommendations: AiRecommendation[] = [];
  const seen = new Set<string>();
  for (const entry of list) {
    const rec = parseOneRecommendation(entry);
    if (!rec) continue;
    const key = normalizeTitle(rec.title.replace(/[《》「」『』]/g, ''));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    recommendations.push(rec);
    if (recommendations.length >= 5) break;
  }

  const keywords = parseKeywordList(
    obj ? obj.searchKeywords ?? obj.search_keywords ?? obj.keywords ?? obj.queries ?? obj.searchQueries : null
  );
  if (keywords.length === 0) {
    for (const rec of recommendations) {
      const key = normalizeTitle(rec.title);
      if (key && !keywords.some((item) => normalizeTitle(item) === key)) keywords.push(rec.title);
      if (keywords.length >= 4) break;
    }
  }

  let reply = obj ? firstString(obj, ['reply', 'answer', 'message', 'content']).slice(0, 4000) : '';
  if (!reply && recommendations.length > 0) reply = '我找到了这几部可能符合的影片：';
  return { reply, recommendations, keywords };
}

/** 把配置里可能携带的空白清理掉，并校验必填项 */
export function normalizeAiConfig(config?: Partial<AiConfig> | null): AiConfig {
  const baseUrl = String(config?.baseUrl || '').trim();
  const apiKey = String(config?.apiKey || '').trim();
  const model = String(config?.model || '').trim();
  if (!baseUrl) throw new Error('请先填写 API 地址');
  if (!model) throw new Error('请先填写模型名称');
  normalizeChatEndpoint(baseUrl);
  return { baseUrl, apiKey, model };
}

/** 构造发给模型的消息：保留最近对话，限制上下文长度；可附带联网搜索结果 */
export function buildChatMessages(
  history: AiChatMessage[],
  next: string,
  options?: { webContext?: string }
): AiChatMessage[] {
  const messages = history
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-8)
    .map((m) => ({ role: m.role, content: m.content.trim().slice(0, 4000) }) as AiChatMessage);
  const text = String(next || '').trim().slice(0, 4000);
  if (text) messages.push({ role: 'user', content: text });
  const system: AiChatMessage[] = [{ role: 'system', content: AI_SYSTEM_PROMPT }];
  const context = String(options?.webContext || '').trim();
  if (context) {
    system.push({
      role: 'system',
      content: '以下是联网搜索返回的参考片段，可能有错或与用户描述无关。只把它们当线索，不要复述原文，仍然只输出规定的 JSON：\n' + context.slice(0, 6000),
    });
  }
  return [...system, ...messages];
}
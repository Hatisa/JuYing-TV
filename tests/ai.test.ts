import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HealthStatus, MediaSummary, SourceConfig } from '../src/types';

const mocks = vi.hoisted(() => ({ searchSource: vi.fn() }));
vi.mock('../src/lib/api', () => ({ searchSource: mocks.searchSource }));

import {
  AI_PROVIDER_PRESETS,
  buildChatMessages,
  isAiConfigured,
  normalizeAiConfig,
  normalizeChatEndpoint,
  parseAiReply,
} from '../src/lib/ai';
import { lookupRecommendation, rankLookupSources, recommendationQueries } from '../src/lib/ai-lookup';

function media(overrides: Partial<MediaSummary> & { name: string; sourceKey: string }): MediaSummary {
  return {
    sourceName: overrides.sourceKey,
    vodId: overrides.name,
    ...overrides,
  } as MediaSummary;
}

function source(key: string, enabled = true, isAdult = false): SourceConfig {
  return { key, name: key, url: 'https://' + key + '.example.com/api.php/provide/vod', enabled, isAdult };
}

function health(state: HealthStatus['state']): HealthStatus {
  return { key: state, name: state, state, ok: state === 'online', ms: 1, checkedAt: 1, failStreak: 0 };
}

describe('AI 接口地址规范化', () => {
  it('根地址补全默认 v1 路径', () => {
    expect(normalizeChatEndpoint('https://api.deepseek.com')).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(normalizeChatEndpoint('https://api.deepseek.com/')).toBe('https://api.deepseek.com/v1/chat/completions');
  });

  it('保留已有的版本路径', () => {
    expect(normalizeChatEndpoint('https://api.openai.com/v1')).toBe('https://api.openai.com/v1/chat/completions');
    expect(normalizeChatEndpoint('https://open.bigmodel.cn/api/paas/v4')).toBe(
      'https://open.bigmodel.cn/api/paas/v4/chat/completions'
    );
    expect(normalizeChatEndpoint('http://127.0.0.1:11434/v1/')).toBe('http://127.0.0.1:11434/v1/chat/completions');
  });

  it('完整地址保持原样并去掉 hash', () => {
    expect(normalizeChatEndpoint('https://api.openai.com/v1/chat/completions')).toBe(
      'https://api.openai.com/v1/chat/completions'
    );
    expect(normalizeChatEndpoint('https://x.com/v1/chat/completions#x')).toBe('https://x.com/v1/chat/completions');
  });

  it('拒绝空地址与非法协议', () => {
    expect(() => normalizeChatEndpoint('')).toThrow('请先填写 API 地址');
    expect(() => normalizeChatEndpoint('ftp://x.com')).toThrow('只支持 http:// 或 https://');
    expect(() => normalizeChatEndpoint('not a url')).toThrow('格式不正确');
  });

  it('规范化配置并校验必填项', () => {
    expect(normalizeAiConfig({ baseUrl: ' https://api.deepseek.com ', apiKey: ' sk-1 ', model: ' deepseek-chat ' })).toEqual({
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk-1',
      model: 'deepseek-chat',
    });
    expect(() => normalizeAiConfig({ baseUrl: '', model: 'x' })).toThrow('请先填写 API 地址');
    expect(() => normalizeAiConfig({ baseUrl: 'https://x.com', model: '' })).toThrow('请先填写模型名称');
    expect(isAiConfigured({ baseUrl: 'https://x.com', model: 'm', apiKey: '' })).toBe(true);
    expect(isAiConfigured({ baseUrl: 'https://x.com', model: '', apiKey: 'k' })).toBe(false);
  });

  it('内置供应商预设都有可用地址和模型', () => {
    expect(AI_PROVIDER_PRESETS.length).toBeGreaterThanOrEqual(5);
    for (const preset of AI_PROVIDER_PRESETS) {
      expect(() => normalizeChatEndpoint(preset.baseUrl)).not.toThrow();
      expect(preset.model.length).toBeGreaterThan(0);
    }
  });
});

describe('AI 回复解析', () => {
  it('解析纯 JSON 并归一化字段', () => {
    const reply = parseAiReply(
      JSON.stringify({
        reply: '最可能是《西游记》。',
        recommendations: [
          {
            title: '西游记',
            originalTitle: 'Journey to the West',
            year: '1986',
            type: '剧集',
            reason: '和尚取经、四个徒弟、神仙妖魔',
            confidence: '高',
          },
          { title: '  ', reason: '空标题应跳过' },
          { name: '大话西游', year: 1800, confidence: 'low' },
        ],
      })
    );
    expect(reply.reply).toBe('最可能是《西游记》。');
    expect(reply.recommendations).toHaveLength(2);
    expect(reply.recommendations[0]).toMatchObject({
      title: '西游记',
      originalTitle: 'Journey to the West',
      year: 1986,
      type: 'series',
      confidence: 'high',
    });
    expect(reply.recommendations[1].year).toBeUndefined();
    expect(reply.recommendations[1].reason).toBe('剧情描述与这部作品较为接近');
  });

  it('兼容代码块和 JSON 前后解释文字', () => {
    const fence = String.fromCharCode(96).repeat(3);
    const payload = JSON.stringify({ reply: '找到了', recommendations: [{ title: '盗梦空间', reason: '梦中梦' }] });
    const wrapped = '我来分析一下。\n' + fence + 'json\n' + payload + '\n' + fence + '\n希望有帮助。';
    const reply = parseAiReply(wrapped);
    expect(reply.reply).toBe('找到了');
    expect(reply.recommendations[0].title).toBe('盗梦空间');
  });

  it('JSON 字符串中的花括号不会截断解析', () => {
    const payload = JSON.stringify({
      reply: '包含 { 和 } 的说明',
      recommendations: [{ title: '黑客帝国', reason: '红药丸 { 蓝药丸 }' }],
    });
    const reply = parseAiReply('前缀 ' + payload + ' 后缀');
    expect(reply.recommendations[0].reason).toContain('红药丸');
  });

  it('支持顶层数组、别名键与去重限量', () => {
    const list = [
      { name: '西游记' },
      { cnTitle: '《西游记》' },
      { title: '西游记续集' },
      { title: '红楼梦' },
      { title: '三国演义' },
      { title: '水浒传' },
      { title: '天龙八部' },
    ];
    const reply = parseAiReply(JSON.stringify(list));
    expect(reply.reply).toBe('我找到了这几部可能符合的影片：');
    expect(reply.recommendations.map((x) => x.title)).toEqual(['西游记', '西游记续集', '红楼梦', '三国演义', '水浒传']);
  });

  it('解析 searchKeywords 并去重去书名号', () => {
    const reply = parseAiReply(
      JSON.stringify({
        reply: '可能是《西游记》。',
        searchKeywords: ['《西游记》', ' 西游记 ', '大话西游', '西游伏妖篇', '西游记女儿国', '越界关键词'],
        recommendations: [{ title: '西游记' }],
      })
    );
    expect(reply.keywords).toEqual(['西游记', '大话西游', '西游伏妖篇', '西游记女儿国']);
  });

  it('缺少 searchKeywords 时用推荐片名补齐', () => {
    const reply = parseAiReply(
      JSON.stringify({
        reply: '找到了这两部。',
        recommendations: [{ title: '西游记' }, { title: '西游记续集' }],
      })
    );
    expect(reply.keywords).toEqual(['西游记', '西游记续集']);
  });

  it('截断或损坏的 JSON 不原样作为回复', () => {
    const reply = parseAiReply('{"reply":"x","recommendations":[{"title":"西游记"');
    expect(reply).toEqual({ reply: '', recommendations: [], keywords: [] });
    expect(parseAiReply('[')).toEqual({ reply: '', recommendations: [], keywords: [] });
  });

  it('纯文本中的《片名》兜底为低置信候选与关键词', () => {
    const reply = parseAiReply('你说的应该是《西游记》，另外《大话西游》也有相似设定。');
    expect(reply.reply).toContain('西游记');
    expect(reply.recommendations.map((x) => x.title)).toEqual(['西游记', '大话西游']);
    expect(reply.recommendations.every((x) => x.confidence === 'low')).toBe(true);
    expect(reply.keywords).toEqual(['西游记', '大话西游']);
  });

  it('兼容顶层字符串数组与逗号分隔的关键词', () => {
    const list = parseAiReply(JSON.stringify(['《西游记》', '大话西游', '  ']));
    expect(list.recommendations.map((x) => x.title)).toEqual(['西游记', '大话西游']);
    expect(list.keywords).toEqual(['西游记', '大话西游']);
    const split = parseAiReply(
      JSON.stringify({ reply: '可能是西游记。', searchKeywords: '西游记, 大话西游、西游伏妖篇' })
    );
    expect(split.keywords).toEqual(['西游记', '大话西游', '西游伏妖篇']);
  });

  it('带前置说明的截断 JSON 也不当作回复', () => {
    const reply = parseAiReply('好的，结果如下：\n{"reply":"x","recommendations":[{"title":"西游记"');
    expect(reply).toEqual({ reply: '', recommendations: [], keywords: [] });
  });

  it('顶层数组也会从片名补齐关键词', () => {
    const reply = parseAiReply(JSON.stringify([{ title: '西游记' }, { title: '红楼梦' }]));
    expect(reply.keywords).toEqual(['西游记', '红楼梦']);
  });

  it('解析失败按纯文本回复', () => {
    const reply = parseAiReply('抱歉，我不确定你说的是哪部片子，能再描述一个角色吗？');
    expect(reply.recommendations).toEqual([]);
    expect(reply.reply).toContain('抱歉');
  });
});

describe('对话消息构造', () => {
  it('注入系统提示并限制历史条数', () => {
    const history = Array.from({ length: 10 }, (_, i) => ({ role: 'user' as const, content: 'h' + i }));
    const messages = buildChatMessages(history, '  新问题  ');
    expect(messages).toHaveLength(10);
    expect(messages[0].role).toBe('system');
    expect(messages[1].content).toBe('h2');
    expect(messages[messages.length - 1]).toEqual({ role: 'user', content: '新问题' });
  });

  it('过滤系统消息和空内容，并截断超长文本', () => {
    const messages = buildChatMessages(
      [
        { role: 'system', content: '越权指令' },
        { role: 'user', content: '   ' },
        { role: 'assistant', content: 'a'.repeat(5000) },
      ],
      ''
    );
    expect(messages).toHaveLength(2);
    expect(messages[1].content).toHaveLength(4000);
  });
});

describe('片库查找', () => {
  beforeEach(() => {
    mocks.searchSource.mockReset();
  });

  it('生成片名、去书名号/年份括号和原名查询词', () => {
    expect(recommendationQueries({ title: '《西游记》（1986）', originalTitle: 'Journey to the West', reason: '', confidence: 'high' })).toEqual([
      '《西游记》（1986）',
      '西游记',
      'Journey to the West',
    ]);
    expect(recommendationQueries({ title: '西游记', originalTitle: '西游记', reason: '', confidence: 'high' })).toEqual(['西游记']);
  });

  it('按健康度排序并限制源数量，排除停用源', () => {
    const sources = [source('off'), source('on'), source('slow'), source('disabled', false)];
    const statuses = { off: health('offline'), on: health('online'), slow: health('slow') };
    expect(rankLookupSources(sources, statuses, 2).map((s) => s.key)).toEqual(['on', 'slow']);
    expect(rankLookupSources(sources, statuses, 10).map((s) => s.key)).toEqual(['on', 'slow', 'off']);
  });

  it('优先返回完全匹配的片名，并合并多源', async () => {
    mocks.searchSource.mockResolvedValue({
      list: [
        media({ name: '西游记续集', sourceKey: 'a' }),
        media({ name: '西游记', sourceKey: 'a' }),
        media({ name: '西游记', sourceKey: 'b' }),
      ],
    });
    const result = await lookupRecommendation(
      { title: '西游记', reason: '', confidence: 'high' },
      [source('a'), source('b')]
    );
    expect(result.group?.title).toBe('西游记');
    expect(result.group?.sourceCount).toBe(2);
    expect(result.viaOriginal).toBe(false);
  });

  it('正式名无结果时回退到外文原名', async () => {
    mocks.searchSource.mockImplementation(async (_source: SourceConfig, query: string) => ({
      list: query === 'Journey to the West' ? [media({ name: 'Journey to the West', sourceKey: 'a' })] : [],
    }));
    const result = await lookupRecommendation(
      { title: '西游记', originalTitle: 'Journey to the West', reason: '', confidence: 'high' },
      [source('a')]
    );
    expect(result.group?.title).toBe('Journey to the West');
    expect(result.viaOriginal).toBe(true);
  });

  it('所有源都失败时返回错误，部分失败但无命中返回空', async () => {
    mocks.searchSource.mockRejectedValue(new Error('timeout'));
    const failed = await lookupRecommendation({ title: '西游记', reason: '', confidence: 'high' }, [source('a'), source('b')]);
    expect(failed.error).toBe('timeout');

    mocks.searchSource.mockReset();
    mocks.searchSource
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ list: [media({ name: '无关影片', sourceKey: 'b' })] });
    const empty = await lookupRecommendation({ title: '西游记', reason: '', confidence: 'high' }, [source('a'), source('b')]);
    expect(empty.error).toBeUndefined();
    expect(empty.group).toBeUndefined();
  });

  it('默认过滤成人源与成人条目', async () => {
    mocks.searchSource.mockResolvedValue({
      list: [media({ name: '西游记', sourceKey: 'a', isAdult: true })],
    });
    const filteredSource = await lookupRecommendation(
      { title: '西游记', reason: '', confidence: 'high' },
      [source('adult', true, true)]
    );
    expect(filteredSource.group).toBeUndefined();
    expect(mocks.searchSource).not.toHaveBeenCalled();

    mocks.searchSource.mockResolvedValue({ list: [media({ name: '西游记', sourceKey: 'a', isAdult: true })] });
    const filteredItem = await lookupRecommendation({ title: '西游记', reason: '', confidence: 'high' }, [source('a')]);
    expect(filteredItem.group).toBeUndefined();
  });
});

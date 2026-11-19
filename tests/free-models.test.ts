import { describe, expect, it } from 'vitest';
import {
  availableFreeModels,
  defaultFreeModelSeeds,
  freeContentOf,
  freeModelId,
  freeModelScore,
  parseKiloFreeModels,
  rankFreeModels,
  shouldAutoCheckin,
  utc8Date,
} from '../src/lib/free-models';
import type { AiFreeModelInfo } from '../src/types';

function model(patch: Partial<AiFreeModelInfo>): AiFreeModelInfo {
  return {
    id: 'kilo/test',
    provider: 'kilo',
    providerName: 'Kilo',
    model: 'test',
    endpoint: 'https://example.com/chat/completions',
    state: 'unknown',
    ok: false,
    ms: 0,
    checkedAt: 0,
    failStreak: 0,
    successCount: 0,
    failCount: 0,
    ...patch,
  };
}

describe('utc8Date', () => {
  it('按北京时间跨日', () => {
    expect(utc8Date(Date.UTC(2026, 0, 1, 15, 59))).toBe('2026-01-01');
    expect(utc8Date(Date.UTC(2026, 0, 1, 16, 0))).toBe('2026-01-02');
  });
});

describe('shouldAutoCheckin', () => {
  const now = Date.UTC(2026, 0, 1, 16, 0);
  it('每天只签到一次', () => {
    expect(shouldAutoCheckin(true, '2026-01-01', now)).toBe(true);
    expect(shouldAutoCheckin(true, '2026-01-02', now)).toBe(false);
    expect(shouldAutoCheckin(false, '2026-01-01', now)).toBe(false);
  });
});

describe('parseKiloFreeModels', () => {
  it('只保留可聊天的免费模型', () => {
    const ids = parseKiloFreeModels({
      data: [
        { id: 'kilo-auto/free' },
        { id: 'deepseek/deepseek-chat:free' },
        { id: 'paid/model' },
        { id: 'image/free', architecture: { output_modalities: ['image'] } },
        { id: 'vision/free', architecture: { output_modalities: ['text', 'image'] } },
        { id: 'deepseek/deepseek-chat:free' },
        'meta/llama:free',
        { id: 'embed/free' },
      ],
    });
    expect(ids).toEqual(['kilo-auto/free', 'deepseek/deepseek-chat:free', 'vision/free', 'meta/llama:free']);
  });

  it('兼容直接返回数组', () => {
    expect(parseKiloFreeModels(['a/b:free'])).toEqual(['a/b:free']);
    expect(parseKiloFreeModels(null)).toEqual([]);
  });
});

describe('freeModelId', () => {
  it('内置模型用 provider/model，自定义通道叠加 channelId', () => {
    expect(freeModelId({ provider: 'kilo', model: 'kilo-auto/free' })).toBe('kilo/kilo-auto/free');
    expect(freeModelId({ provider: 'custom', channelId: 'ch-a', model: 'gpt-4o-mini' })).toBe(
      'custom/ch-a/gpt-4o-mini'
    );
  });
});

describe('defaultFreeModelSeeds', () => {
  it('内置三个公开模型，并把启用通道并入免费池', () => {
    const seeds = defaultFreeModelSeeds('https://kilo.example/v1/', '', [
      {
        id: 'ch-a',
        name: 'OpenRouter 免费',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: 'k',
        model: 'meta-llama/llama-3.3-70b-instruct:free',
        enabled: true,
      },
    ]);
    expect(seeds.map((s) => s.model)).toEqual([
      'kilo-auto/free',
      'reflection/beam-free',
      'openai-fast',
      'meta-llama/llama-3.3-70b-instruct:free',
    ]);
    expect(seeds[0].endpoint).toBe('https://kilo.example/v1/chat/completions');
    expect(seeds[2].endpoint).toBe('https://text.pollinations.ai/openai');
    expect(seeds[3]).toMatchObject({
      provider: 'custom',
      channelId: 'ch-a',
      providerName: 'OpenRouter 免费',
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    });
  });

  it('跳过未启用或地址/模型未填完的通道，且不抛错', () => {
    const seeds = defaultFreeModelSeeds('', '', [
      { id: 'off', name: '关闭', baseUrl: 'https://a.example/v1', model: 'm', enabled: false },
      { id: 'blank', name: '半成品', baseUrl: '', model: 'm', enabled: true },
      { id: 'nomodel', name: '缺模型', baseUrl: 'https://b.example/v1', model: '', enabled: true },
    ]);
    expect(seeds).toHaveLength(3);
    expect(seeds.map((s) => s.provider)).toEqual(['kilo', 'kilo', 'pollinations']);
  });
});

describe('rankFreeModels', () => {
  it('在线优先，冷却模型排最后', () => {
    const online = model({ id: 'online', state: 'online', ms: 500, successCount: 4 });
    const slow = model({ id: 'slow', state: 'slow', ms: 6000 });
    const offline = model({ id: 'offline', state: 'offline', failStreak: 2 });
    const cooling = model({ id: 'cooling', state: 'online', cooldownUntil: Date.now() + 60_000 });
    expect(rankFreeModels([cooling, offline, slow, online]).map((m) => m.id)).toEqual([
      'online',
      'slow',
      'offline',
      'cooling',
    ]);
    expect(freeModelScore(cooling)).toBeLessThan(freeModelScore(offline));
  });

  it('统计可用模型时排除冷却', () => {
    const now = Date.now();
    const models = [
      model({ id: 'a', state: 'online' }),
      model({ id: 'b', state: 'slow' }),
      model({ id: 'c', state: 'online', cooldownUntil: now + 1000 }),
      model({ id: 'd', state: 'offline' }),
    ];
    expect(availableFreeModels(models, now)).toBe(2);
  });
});

describe('freeContentOf', () => {
  it('兼容 content 数组、reasoning 与旧式 text', () => {
    expect(freeContentOf({ choices: [{ message: { content: [{ text: '你' }, { text: '好' }] } }] })).toBe('你好');
    expect(freeContentOf({ choices: [{ message: { content: '', reasoning: '思考结果' } }] })).toBe('思考结果');
    expect(freeContentOf({ choices: [{ text: '旧格式' }] })).toBe('旧格式');
    expect(freeContentOf({})).toBe('');
  });
});

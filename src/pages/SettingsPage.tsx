import { useEffect, useState, type ReactNode } from 'react';
import {
  Bot,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  ExternalLink,
  FolderOpen,
  Globe2,
  Info,
  KeyRound,
  Loader2,
  Palette,
  PlayCircle,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Server,
  ShieldCheck,
  Trash2,
  Zap,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import ConfirmModal from '../components/ConfirmModal';
import { PageHeader } from '../components/States';
import { AI_PROVIDER_PRESETS, aiMode, isAiConfigured, isAiUsable } from '../lib/ai';
import { api } from '../lib/bridge';
import { FEATURES } from '../lib/features';
import { DEFAULT_SOURCES } from '../lib/default-sources';
import { freeModelStateLabel } from '../lib/free-models';
import { formatMs, relativeTime, stateColor, stateLabel, summarize } from '../lib/health';
import { useApp } from '../store/app';
import { useHealth } from '../store/health';
import { WEB_SEARCH_PROVIDERS, webSearchProviderName } from '../lib/web-search';
import type { AiFreeStatus, AiTestResult, AppInfo, FreeModelChannel, WebSearchTestResult } from '../types';

/** 常见免费额度供应商，快速填入地址与模型（Key 仍需自己填） */
const FREE_CHANNEL_PRESETS: { name: string; baseUrl: string; model: string }[] = [
  { name: 'OpenRouter 免费', baseUrl: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct:free' },
  { name: 'Google AI Studio', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.0-flash' },
  { name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  { name: 'GitHub Models', baseUrl: 'https://models.inference.ai.azure.com', model: 'gpt-4o-mini' },
];

function Section({ title, icon, desc, children, collapsible = false, defaultOpen = true, summary }: {
  title: string;
  icon: ReactNode;
  desc?: string;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  summary?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const expanded = !collapsible || open;
  const head = (
    <>
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[var(--brand-soft)] text-[var(--brand)]">{icon}</div>
      <div className="min-w-0">
        <h2 className="text-[14.5px] font-semibold">{title}</h2>
        {desc && <p className="mt-0.5 text-[11.5px] text-[var(--muted)]">{desc}</p>}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2 text-[11.5px] text-[var(--muted)]">
        {summary && <span>{summary}</span>}
        {collapsible && <ChevronDown className={'h-4 w-4 transition-transform ' + (open ? 'rotate-180' : '')} />}
      </div>
    </>
  );
  return (
    <section className="surface rounded-2xl p-5">
      {collapsible ? (
        <button
          type="button"
          data-section={title}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={'flex w-full items-start gap-2.5 text-left ' + (expanded ? 'mb-4' : '')}
        >
          {head}
        </button>
      ) : (
        <div className="mb-4 flex items-start gap-2.5">{head}</div>
      )}
      {expanded && children}
    </section>
  );
}

function Toggle({ value, onChange, testId }: { value: boolean; onChange: (v: boolean) => void; testId?: string }) {
  return (
    <button
      type="button"
      role="switch"
      data-testid={testId}
      aria-checked={value}
      onClick={() => onChange(!value)}
      className={`relative h-[22px] w-[40px] shrink-0 rounded-full transition-colors ${value ? 'bg-[var(--brand)]' : 'bg-[var(--panel-2)] border border-[var(--border-strong)]'}`}
    >
      <span
        className={`absolute top-1/2 h-[16px] w-[16px] -translate-y-1/2 rounded-full bg-white shadow transition-all ${value ? 'left-[21px]' : 'left-[3px]'}`}
      />
    </button>
  );
}

export default function SettingsPage() {
  const settings = useApp((s) => s.settings);
  const updateSettings = useApp((s) => s.updateSettings);
  const sources = useApp((s) => s.sources);
  const liveSources = useApp((s) => s.liveSources);
  const updateSource = useApp((s) => s.updateSource);
  const removeSource = useApp((s) => s.removeSource);
  const addSource = useApp((s) => s.addSource);
  const resetSources = useApp((s) => s.resetSources);
  const updateLiveSource = useApp((s) => s.updateLiveSource);
  const removeLiveSource = useApp((s) => s.removeLiveSource);
  const addLiveSource = useApp((s) => s.addLiveSource);

  const healthStatuses = useHealth((s) => s.statuses);
  const checking = useHealth((s) => s.checking);
  const checked = useHealth((s) => s.checked);
  const total = useHealth((s) => s.total);
  const checkAll = useHealth((s) => s.checkAll);

  const [info, setInfo] = useState<AppInfo | null>(null);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newLiveName, setNewLiveName] = useState('');
  const [newLiveUrl, setNewLiveUrl] = useState('');
  const [adultConfirm, setAdultConfirm] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<AiTestResult | null>(null);
  const [freeStatus, setFreeStatus] = useState<AiFreeStatus | null>(null);
  const [freeBusy, setFreeBusy] = useState<'checkin' | 'test' | null>(null);
  const [webTesting, setWebTesting] = useState(false);
  const [webResult, setWebResult] = useState<WebSearchTestResult | null>(null);

  const aiModeValue = aiMode(settings.ai);
  const aiReady = isAiUsable(settings.ai);
  const updateAi = (patch: Partial<typeof settings.ai>) => {
    setTestResult(null);
    updateSettings({ ai: { ...settings.ai, ...patch } });
  };
  const channels = settings.ai.freeChannels || [];
  const updateChannels = (next: FreeModelChannel[]) => updateAi({ freeChannels: next });
  const patchChannel = (id: string, patch: Partial<FreeModelChannel>) =>
    updateChannels(channels.map((channel) => (channel.id === id ? { ...channel, ...patch } : channel)));
  const addChannel = (preset?: { name: string; baseUrl: string; model: string }) => {
    if (channels.length >= 8) return;
    updateChannels([
      ...channels,
      {
        id: 'ch-' + Date.now().toString(36),
        name: preset?.name || '自定义通道 ' + (channels.length + 1),
        baseUrl: preset?.baseUrl || '',
        apiKey: '',
        model: preset?.model || '',
        enabled: true,
      },
    ]);
  };
  const removeChannel = (id: string) => updateChannels(channels.filter((channel) => channel.id !== id));
  const updateWeb = (patch: Partial<typeof settings.webSearch>) => {
    setWebResult(null);
    updateSettings({ webSearch: { ...settings.webSearch, ...patch } });
  };
  const testWeb = async () => {
    if (webTesting) return;
    setWebTesting(true);
    setWebResult(null);
    try {
      setWebResult(await api.websearch.test({ ...settings.webSearch, enabled: true }));
    } catch (err: any) {
      setWebResult({ ok: false, count: 0, error: err?.message || '联网搜索测试失败', ms: 0 });
    } finally {
      setWebTesting(false);
    }
  };
  const testAi = async () => {
    if (testing) return;
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await api.ai.test(settings.ai));
    } catch (err: any) {
      setTestResult({ ok: false, error: err?.message || '测试失败' });
    } finally {
      setTesting(false);
    }
  };

  useEffect(() => {
    void api.app.info().then(setInfo).catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    void api.ai.free
      .status()
      .then((status) => {
        if (alive) setFreeStatus(status);
      })
      .catch(() => {});
    const off = api.ai.free.onChange((status) => setFreeStatus(status));
    return () => {
      alive = false;
      off();
    };
  }, []);

  // 自定义通道修改后写入主进程并立即重建 Auto 池（不触发网络探测）
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = useApp.getState().settings;
      void api.store
        .write('settings', next)
        .then(() => api.ai.free.sync())
        .catch(() => {});
    }, 600);
    return () => clearTimeout(timer);
  }, [settings.ai.freeChannels]);

  const runFreeCheck = async (kind: 'checkin' | 'test') => {
    if (freeBusy) return;
    setFreeBusy(kind);
    setTestResult(null);
    try {
      const status = kind === 'checkin' ? await api.ai.free.checkin() : await api.ai.free.test();
      setFreeStatus(status);
    } catch (err: any) {
      setTestResult({ ok: false, error: err?.message || '免费模型检测失败' });
    } finally {
      setFreeBusy(null);
    }
  };


  const summary = summarize(healthStatuses, sources.map((s) => s.key));
  const lastChecked = Math.max(0, ...sources.map((s) => healthStatuses[s.key]?.checkedAt || 0));
  const progress = total > 0 ? Math.round((checked / total) * 100) : 0;

  const submitSource = () => {
    const name = newName.trim();
    const url = newUrl.trim();
    if (!name || !/^https?:\/\//i.test(url)) return;
    addSource({ name, url, enabled: true });
    setNewName('');
    setNewUrl('');
  };

  const submitLive = () => {
    const name = newLiveName.trim();
    const url = newLiveUrl.trim();
    if (!name || !/^https?:\/\//i.test(url)) return;
    addLiveSource({ name, url, enabled: true });
    setNewLiveName('');
    setNewLiveUrl('');
  };

  return (
    <div className="animate-fade-in px-7 py-6">
      <PageHeader title="设置" subtitle="个性化播放体验与管理你的数据源" />

      <div className="max-w-4xl space-y-4">
        <Section title="外观" icon={<Palette className="h-4 w-4" />} desc="主题与强调色会立即生效">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[13px]">深色模式</div>
                <div className="text-[11.5px] text-[var(--muted)]">夜间观看更护眼</div>
              </div>
              <Toggle value={settings.theme === 'dark'} onChange={(v) => updateSettings({ theme: v ? 'dark' : 'light' })} />
            </div>
            <div>
              <div className="mb-2 text-[13px]">强调色</div>
              <div className="flex gap-2.5">
                {(
                  [
                    ['rose', '#f43f5e'],
                    ['amber', '#f59e0b'],
                    ['violet', '#8b5cf6'],
                    ['cyan', '#06b6d4'],
                  ] as const
                ).map(([key, color]) => (
                  <button
                    key={key}
                    onClick={() => updateSettings({ accent: key })}
                    className={`grid h-9 w-9 place-items-center rounded-full transition-transform hover:scale-105 ${settings.accent === key ? 'ring-2 ring-offset-2 ring-offset-[var(--panel)]' : ''}`}
                    style={{ backgroundColor: color, ...(settings.accent === key ? { ['--tw-ring-color' as any]: color } : {}) }}
                    title={key}
                  >
                    {settings.accent === key && <Check className="h-4 w-4 text-white" />}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Section>

        <Section title="播放" icon={<PlayCircle className="h-4 w-4" />} desc="这些设置会应用到所有视频">
          <div className="space-y-3.5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[13px]">自动播放</div>
                <div className="text-[11.5px] text-[var(--muted)]">打开剧集后立即开始播放</div>
              </div>
              <Toggle value={settings.autoPlay} onChange={(v) => updateSettings({ autoPlay: v })} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[13px]">自动连播下一集</div>
                <div className="text-[11.5px] text-[var(--muted)]">当前集播完后自动跳转</div>
              </div>
              <Toggle value={settings.autoNext} onChange={(v) => updateSettings({ autoNext: v })} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[13px]">记录观看进度</div>
                <div className="text-[11.5px] text-[var(--muted)]">下次打开时从上次位置继续</div>
              </div>
              <Toggle value={settings.rememberProgress} onChange={(v) => updateSettings({ rememberProgress: v })} />
            </div>

            <div className="grid grid-cols-2 gap-4 border-t border-[var(--border)] pt-3.5">
              <label className="block">
                <div className="mb-1.5 flex items-center justify-between text-[12.5px]">
                  <span>默认音量</span>
                  <span className="text-[var(--muted)]">{Math.round(settings.volume * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={settings.volume}
                  onChange={(e) => updateSettings({ volume: Number(e.target.value) })}
                  className="w-full accent-[var(--brand)]"
                />
              </label>
              <label className="block">
                <div className="mb-1.5 text-[12.5px]">默认倍速</div>
                <select
                  value={settings.playbackRate}
                  onChange={(e) => updateSettings({ playbackRate: Number(e.target.value) })}
                  className="input py-1.5 text-[12.5px]"
                >
                  {[0.75, 1, 1.25, 1.5, 2].map((r) => (
                    <option key={r} value={r}>
                      {r}x
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </Section>

        <Section
          title="AI 推荐助手"
          icon={<Bot className="h-4 w-4" />}
          desc="配置 OpenAI 兼容的模型供应商，用模糊剧情描述找片"
          collapsible
          defaultOpen={false}
          summary={
            aiModeValue === 'auto'
              ? '免费 Auto' + (freeStatus ? ' · ' + freeStatus.available + ' 可用' : '')
              : isAiConfigured(settings.ai)
                ? settings.ai.model
                : '未配置'
          }
        >
          <div data-testid="ai-config-section" className="space-y-3.5">
            <>
                <div data-testid="ai-mode" className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    data-testid="ai-mode-auto"
                    aria-pressed={aiModeValue === 'auto'}
                    onClick={() => updateAi({ mode: 'auto' })}
                    className={
                      'rounded-xl border px-3 py-2.5 text-left transition-colors ' +
                      (aiModeValue === 'auto'
                        ? 'border-[var(--brand)] bg-[var(--brand-soft)]'
                        : 'border-[var(--border)] bg-[var(--panel-2)] hover:border-[var(--border-strong)]')
                    }
                  >
                    <div className="flex items-center gap-1.5 text-[12.5px] font-medium">
                      <Zap className="h-3.5 w-3.5 text-[var(--brand)]" /> 免费 Auto
                      <span className="rounded bg-[var(--brand-soft)] px-1.5 py-0.5 text-[10px] font-normal text-[var(--brand)]">
                        无需 Key
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-[var(--muted)]">
                      内置免费模型池，自动选择可用模型；每天自动签到刷新额度。
                    </p>
                  </button>
                  <button
                    type="button"
                    data-testid="ai-mode-custom"
                    aria-pressed={aiModeValue === 'custom'}
                    onClick={() => updateAi({ mode: 'custom' })}
                    className={
                      'rounded-xl border px-3 py-2.5 text-left transition-colors ' +
                      (aiModeValue === 'custom'
                        ? 'border-[var(--brand)] bg-[var(--brand-soft)]'
                        : 'border-[var(--border)] bg-[var(--panel-2)] hover:border-[var(--border-strong)]')
                    }
                  >
                    <div className="flex items-center gap-1.5 text-[12.5px] font-medium">
                      <KeyRound className="h-3.5 w-3.5 text-[var(--brand)]" /> 自定义 API
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-[var(--muted)]">
                      使用自己的 OpenAI 兼容供应商，适合已有 Key 或本地模型。
                    </p>
                  </button>
                </div>

                {aiModeValue === 'auto' ? (
                  <div data-testid="ai-free-panel" className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-3.5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2 text-[13px] font-medium">
                          免费模型池
                          <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-normal text-emerald-400">
                            Auto 自动选路
                          </span>
                        </div>
                        <div className="mt-0.5 text-[11.5px] text-[var(--muted)]" data-testid="ai-free-summary">
                          {freeStatus
                            ? freeStatus.available > 0
                              ? freeStatus.available + '/' + freeStatus.models.length + ' 个模型可用'
                              : '暂未检测到可用模型'
                            : '正在读取免费通道状态…'}
                          {freeStatus?.lastResult ? ' · ' + freeStatus.lastResult : ''}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          data-testid="ai-free-checkin"
                          className="btn btn-primary h-8 px-3 text-[12px]"
                          onClick={() => void runFreeCheck('checkin')}
                          disabled={!!freeBusy}
                        >
                          {freeBusy === 'checkin' ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3.5 w-3.5" />
                          )}
                          {freeBusy === 'checkin' ? '签到中…' : '一键签到'}
                        </button>
                        <button
                          type="button"
                          data-testid="ai-free-test"
                          className="btn btn-ghost h-8 px-3 text-[12px]"
                          onClick={() => void runFreeCheck('test')}
                          disabled={!!freeBusy}
                        >
                          {freeBusy === 'test' ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Zap className="h-3.5 w-3.5" />
                          )}
                          {freeBusy === 'test' ? '检测中…' : '一键检测全部免费模型'}
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2">
                      <div>
                        <div className="text-[12px]">每日自动签到</div>
                        <div className="mt-0.5 text-[10.5px] text-[var(--muted)]">
                          {freeStatus?.lastCheckinAt
                            ? '上次签到：' + relativeTime(freeStatus.lastCheckinAt) + ' · 每日按北京时间刷新'
                            : '启动后自动签到一次，之后每 30 分钟检查是否跨天'}
                        </div>
                      </div>
                      <Toggle
                        testId="ai-auto-checkin"
                        value={settings.ai.autoCheckin !== false}
                        onChange={(v) => updateAi({ autoCheckin: v })}
                      />
                    </div>

                    <div data-testid="ai-channels" className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2.5">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="flex flex-wrap items-center gap-1.5 text-[12px] font-medium">
                            <Globe2 className="h-3.5 w-3.5 text-[var(--muted)]" />
                            自定义免费通道
                            <span className="rounded bg-[var(--brand-soft)] px-1.5 py-0.5 text-[10px] font-normal text-[var(--brand)]">
                              自动加入 Auto
                            </span>
                          </div>
                          <div className="mt-0.5 text-[10.5px] leading-relaxed text-[var(--muted)]">
                            任意 OpenAI 兼容端点，填自己的免费额度 Key；与内置 Kilo / Pollinations 一起排序，无需 dsh 或任何账号登录。
                          </div>
                        </div>
                        <button
                          type="button"
                          data-testid="ai-channel-add"
                          className="btn btn-ghost h-7 px-2.5 text-[11px]"
                          onClick={() => addChannel()}
                          disabled={channels.length >= 8}
                        >
                          <Plus className="h-3 w-3" /> 添加通道
                        </button>
                      </div>

                      {channels.length === 0 ? (
                        <div className="mt-2 rounded-lg border border-dashed border-[var(--border)] px-3 py-2.5 text-center text-[10.5px] text-[var(--muted)]">
                          暂无自定义通道。可从下方预设开始，填入自己的 Key 后启用。
                        </div>
                      ) : (
                        <div className="mt-2.5 space-y-2">
                          {channels.map((channel, index) => (
                            <div key={channel.id} data-testid="ai-channel" className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2.5 py-2">
                              <div className="flex items-center gap-2">
                                <span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-[var(--brand-soft)] text-[10px] text-[var(--brand)]">
                                  {index + 1}
                                </span>
                                <input
                                  data-testid="ai-channel-name"
                                  className="input h-7 min-w-0 flex-1 text-[11px]"
                                  value={channel.name}
                                  onChange={(e) => patchChannel(channel.id, { name: e.target.value })}
                                  placeholder="通道名称"
                                  spellCheck={false}
                                />
                                <Toggle
                                  testId="ai-channel-toggle"
                                  value={channel.enabled}
                                  onChange={(v) => patchChannel(channel.id, { enabled: v })}
                                />
                                <button
                                  type="button"
                                  data-testid="ai-channel-remove"
                                  className="grid h-7 w-7 shrink-0 place-items-center rounded text-[var(--muted)] hover:bg-[var(--panel)] hover:text-red-400"
                                  title="删除通道"
                                  onClick={() => removeChannel(channel.id)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                              <div className="mt-1.5 grid gap-1.5 sm:grid-cols-3">
                                <input
                                  data-testid="ai-channel-url"
                                  className="input h-7 text-[10.5px]"
                                  value={channel.baseUrl}
                                  onChange={(e) => patchChannel(channel.id, { baseUrl: e.target.value })}
                                  placeholder="API 地址，如 https://api.groq.com/openai/v1"
                                  spellCheck={false}
                                />
                                <input
                                  data-testid="ai-channel-model"
                                  className="input h-7 text-[10.5px]"
                                  value={channel.model}
                                  onChange={(e) => patchChannel(channel.id, { model: e.target.value })}
                                  placeholder="模型名"
                                  spellCheck={false}
                                />
                                <input
                                  data-testid="ai-channel-key"
                                  className="input h-7 text-[10.5px]"
                                  type="password"
                                  value={channel.apiKey}
                                  onChange={(e) => patchChannel(channel.id, { apiKey: e.target.value })}
                                  placeholder="API Key（本地模型可留空）"
                                  spellCheck={false}
                                  autoComplete="off"
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="mt-2.5">
                        <div className="mb-1 text-[10.5px] text-[var(--muted)]">快捷添加常见免费额度供应商（仍需自己的 Key）</div>
                        <div className="flex flex-wrap gap-1.5">
                          {FREE_CHANNEL_PRESETS.map((preset) => (
                            <button
                              key={preset.name}
                              type="button"
                              className="chip text-[10.5px]"
                              data-preset={preset.name}
                              onClick={() => addChannel(preset)}
                              disabled={channels.length >= 8}
                              title={preset.baseUrl + ' · ' + preset.model}
                            >
                              {preset.name}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="mt-2 text-[10.5px] leading-relaxed text-[var(--muted)]">
                        修改后自动保存并同步到 Auto 池；通道需要健康检测后才会参与选路，失败会自动切换下一个。
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      {(freeStatus?.models || []).map((m) => {
                        const cooling = !!m.cooldownUntil && m.cooldownUntil > Date.now();
                        return (
                          <div
                            key={m.id}
                            data-testid="ai-free-model"
                            data-state={m.state}
                            className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-2.5 py-2"
                          >
                            <span
                              className="h-1.5 w-1.5 shrink-0 rounded-full"
                              style={{ backgroundColor: stateColor(m.state) }}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 text-[11.5px]">
                                <span className="shrink-0">{m.providerName}</span>
                                <span className="truncate font-mono text-[10.5px] text-[var(--muted)]">{m.model}</span>
                              </div>
                              <div className="mt-0.5 truncate text-[10.5px] text-[var(--muted)]">
                                {cooling
                                  ? '冷却到 ' +
                                    new Date(m.cooldownUntil as number).toLocaleTimeString('zh-CN', {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    }) +
                                    (m.error ? ' · ' + m.error : '')
                                  : m.error || freeModelStateLabel(m.state) + (m.checkedAt ? ' · ' + formatMs(m.ms) : '')}
                              </div>
                            </div>
                            <span
                              className={
                                'shrink-0 text-[10.5px] ' +
                                (m.state === 'online' || m.state === 'slow' ? 'text-emerald-400' : 'text-[var(--muted)]')
                              }
                            >
                              {cooling ? '冷却中' : freeModelStateLabel(m.state)}
                            </span>
                          </div>
                        );
                      })}
                      {(!freeStatus || freeStatus.models.length === 0) && (
                        <div className="rounded-lg border border-dashed border-[var(--border)] px-3 py-3 text-center text-[11px] text-[var(--muted)]">
                          还没有模型状态，点击「一键签到」开始检测。
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Link to="/assistant" className="btn btn-primary h-8 px-3 text-[12px]">
                        <Bot className="h-3.5 w-3.5" /> 打开 AI 助手
                      </Link>
                      {testResult && (
                        <span
                          data-testid="ai-test-result"
                          className={'text-[11.5px] ' + (testResult.ok ? 'text-emerald-400' : 'text-red-400')}
                        >
                          {testResult.ok ? '连接成功' : testResult.error || '检测失败'}
                        </span>
                      )}
                    </div>

                    <p className="text-[11px] leading-relaxed text-[var(--muted)]">
                      内置 Kilo 公共网关与 Pollinations 匿名通道，无需 Key；自定义免费通道使用你自己的额度，所有 Key 仅保存在本机。繁忙或失败时会自动切换下一个模型；签到只刷新本机状态与每日额度，不涉及任何账号登录。
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3.5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <div className="mb-1.5 text-[12.5px]">API 地址</div>
                    <input
                      data-testid="ai-base-url"
                      className="input h-9 text-[12px]"
                      value={settings.ai.baseUrl}
                      onChange={(e) => updateAi({ baseUrl: e.target.value })}
                      placeholder="https://api.deepseek.com"
                      spellCheck={false}
                    />
                  </label>
                  <label className="block">
                    <div className="mb-1.5 text-[12.5px]">模型名称</div>
                    <input
                      data-testid="ai-model"
                      className="input h-9 text-[12px]"
                      value={settings.ai.model}
                      onChange={(e) => updateAi({ model: e.target.value })}
                      placeholder="deepseek-chat"
                      spellCheck={false}
                    />
                  </label>
                </div>

                <label className="block">
                  <div className="mb-1.5 flex items-center gap-1.5 text-[12.5px]">
                    <KeyRound className="h-3.5 w-3.5 text-[var(--muted)]" />
                    API Key
                    <span className="text-[11px] font-normal text-[var(--muted)]">仅保存在本机；本地模型可留空</span>
                  </div>
                  <div className="relative">
                    <input
                      data-testid="ai-api-key"
                      className="input h-9 pr-10 text-[12px]"
                      type={showKey ? 'text' : 'password'}
                      value={settings.ai.apiKey}
                      onChange={(e) => updateAi({ apiKey: e.target.value })}
                      placeholder="sk-..."
                      spellCheck={false}
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      className="absolute right-1 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-[var(--muted)] hover:bg-[var(--panel-2)] hover:text-[var(--text)]"
                      onClick={() => setShowKey((v) => !v)}
                      title={showKey ? '隐藏密钥' : '显示密钥'}
                    >
                      {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </label>

                <div>
                  <div className="mb-1.5 text-[11.5px] text-[var(--muted)]">快捷填入常见供应商（仍需填 API Key）</div>
                  <div className="flex flex-wrap gap-1.5">
                    {AI_PROVIDER_PRESETS.map((preset) => (
                      <button
                        key={preset.name}
                        type="button"
                        className="chip text-[11px]"
                        data-preset={preset.name}
                        onClick={() => updateAi({ baseUrl: preset.baseUrl, model: preset.model })}
                        title={preset.baseUrl + ' · ' + preset.model}
                      >
                        {preset.name}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
                  <button
                    type="button"
                    data-testid="ai-test"
                    className="btn btn-primary h-8 px-3 text-[12px]"
                    onClick={() => void testAi()}
                    disabled={testing || !aiReady}
                  >
                    {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                    {testing ? '测试中…' : '测试连接'}
                  </button>
                  <Link to="/assistant" className="btn btn-ghost h-8 px-3 text-[12px]">
                    <Bot className="h-3.5 w-3.5" /> 打开 AI 助手
                  </Link>
                  {testResult && (
                    <span
                      data-testid="ai-test-result"
                      className={'text-[11.5px] ' + (testResult.ok ? 'text-emerald-400' : 'text-red-400')}
                    >
                      {testResult.ok
                        ? '连接成功' + (testResult.model ? ' · ' + testResult.model : '') + (testResult.ms ? ' · ' + testResult.ms + 'ms' : '')
                        : testResult.error || '连接失败'}
                    </span>
                  )}
                </div>

                <p className="text-[11px] leading-relaxed text-[var(--muted)]">
                  支持 OpenAI 兼容接口（DeepSeek、OpenAI、通义千问、Kimi、智谱、本地 Ollama 等）。API 地址可填写根地址、/v1，或完整的 /chat/completions；密钥仅保存在本机数据目录，不会上传到聚影服务器。
                </p>
                  </div>
                )}
              </>
          </div>
        </Section>

        <Section
          title="联网搜索"
          icon={<Globe2 className="h-4 w-4" />}
          desc="AI 助手回答前先搜索网页，补充影片资讯与最新信息"
          collapsible
          defaultOpen={false}
          summary={settings.webSearch.enabled ? webSearchProviderName(settings.webSearch.provider) : '未开启'}
        >
          <div data-testid="websearch-config" className="space-y-3">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2.5">
              <div>
                <div className="text-[12.5px]">启用联网搜索</div>
                <div className="mt-0.5 text-[10.5px] leading-relaxed text-[var(--muted)]">
                  开启后，AI 助手会先按你的剧情描述搜索网页，再把摘要作为参考上下文；搜索失败不会阻断推荐。
                </div>
              </div>
              <Toggle
                testId="websearch-toggle"
                value={settings.webSearch.enabled}
                onChange={(v) => updateWeb({ enabled: v })}
              />
            </div>

            <div data-testid="websearch-providers" className="grid gap-2 sm:grid-cols-3">
              {WEB_SEARCH_PROVIDERS.map((provider) => {
                const active = settings.webSearch.provider === provider.value;
                return (
                  <button
                    key={provider.value}
                    type="button"
                    data-testid={'websearch-provider-' + provider.value}
                    aria-pressed={active}
                    onClick={() => updateWeb({ provider: provider.value })}
                    className={
                      'rounded-xl border px-3 py-2 text-left transition-colors ' +
                      (active
                        ? 'border-[var(--brand)] bg-[var(--brand-soft)]'
                        : 'border-[var(--border)] bg-[var(--panel-2)] hover:border-[var(--border-strong)]')
                    }
                  >
                    <div className="text-[12px] font-medium">{provider.name}</div>
                    <div className="mt-0.5 text-[10.5px] leading-relaxed text-[var(--muted)]">{provider.hint}</div>
                  </button>
                );
              })}
            </div>

            {settings.webSearch.provider !== 'duckduckgo' && settings.webSearch.provider !== 'bing' && (
              <label className="block">
                <div className="mb-1.5 flex items-center gap-1.5 text-[12.5px]">
                  <KeyRound className="h-3.5 w-3.5 text-[var(--muted)]" />
                  {webSearchProviderName(settings.webSearch.provider)} API Key
                  <span className="text-[11px] font-normal text-[var(--muted)]">仅保存在本机</span>
                </div>
                <input
                  data-testid="websearch-key"
                  className="input h-9 text-[12px]"
                  type="password"
                  value={settings.webSearch.apiKey}
                  onChange={(e) => updateWeb({ apiKey: e.target.value })}
                  placeholder="填写搜索服务的 API Key"
                  spellCheck={false}
                  autoComplete="off"
                />
              </label>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <div className="mb-1.5 text-[12.5px]">注入 AI 的结果条数</div>
                <select
                  data-testid="websearch-max"
                  className="input py-1.5 text-[12.5px]"
                  value={settings.webSearch.maxResults}
                  onChange={(e) => updateWeb({ maxResults: Number(e.target.value) })}
                >
                  {[2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n} 条
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-col justify-end">
                <button
                  type="button"
                  data-testid="websearch-test"
                  className="btn btn-primary h-9 px-3 text-[12px]"
                  onClick={() => void testWeb()}
                  disabled={webTesting || !settings.webSearch.enabled}
                >
                  {webTesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Globe2 className="h-3.5 w-3.5" />}
                  {webTesting ? '搜索中…' : '测试搜索'}
                </button>
              </div>
            </div>

            {webResult && (
              <div
                data-testid="websearch-result"
                className={'text-[11.5px] ' + (webResult.ok ? 'text-emerald-400' : 'text-red-400')}
              >
                {webResult.ok
                  ? '搜索成功 · 返回 ' + webResult.count + ' 条结果' + (webResult.ms ? ' · ' + webResult.ms + 'ms' : '')
                  : webResult.error || '搜索失败'}
              </div>
            )}

            <p className="text-[11px] leading-relaxed text-[var(--muted)]">
              搜索在主进程发起，绕过跨域限制。DuckDuckGo 免 Key，可能被限流；Tavily / Serper 更稳定，需要你自己的 Key。搜索结果只作为 AI 的参考片段，不会改变片库数据；助手会单独列出参考来源。
            </p>
          </div>
        </Section>

        <section className="surface rounded-2xl p-5" data-testid="health-panel">
          <div className="mb-3 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-3.5 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-[13px] font-medium">
                  接口健康度
                  <span className="rounded bg-[var(--brand-soft)] px-1.5 py-0.5 text-[10px] font-normal text-[var(--brand)]">实时监测</span>
                </div>
                <div className="mt-0.5 text-[11.5px] text-[var(--muted)]">
                  {checking ? `正在检测 ${checked}/${total} 个接口…` : `最近检测：${relativeTime(lastChecked)} · 共 ${summary.total} 个接口`}
                </div>
              </div>
              <button className="btn btn-primary h-8 px-3 text-[12px]" onClick={() => checkAll()} disabled={checking || sources.length === 0}>
                {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                {checking ? '检测中…' : '一键检测全部'}
              </button>
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px]">
              {([
                ['在线', summary.online, '#22c55e'],
                ['较慢', summary.slow, '#f59e0b'],
                ['离线', summary.offline, '#ef4444'],
                ['未检测', summary.unknown, '#64748b'],
              ] as const).map(([label, value, color]) => (
                <span key={label} className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
                  <span className="text-[var(--muted)]">{label}</span>
                  <span className="font-medium">{value}</span>
                </span>
              ))}
              {checking && (
                <span className="ml-auto flex items-center gap-2 text-[var(--muted)]">
                  <span className="h-1 w-28 overflow-hidden rounded-full bg-[var(--border)]">
                    <span className="block h-full rounded-full bg-[var(--brand)] transition-all" style={{ width: `${progress}%` }} />
                  </span>
                  {progress}%
                </span>
              )}
            </div>
          </div>
        </section>

        <Section
          title="影视数据源"
          icon={<Server className="h-4 w-4" />}
          desc="苹果CMS V10 采集接口，支持自定义添加；后台每 4 分钟自动巡检健康度"
          collapsible
          defaultOpen={false}
          summary={summary.total + ' 个接口 · 可用 ' + (summary.online + summary.slow)}
        >
          <div className="space-y-2">
            {sources.map((s) => {
              const h = healthStatuses[s.key];
              const state = h?.state;
              const live = state === 'online' || state === 'slow';
              return (
                <div key={s.key} className="rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2.5">
                  <div className="flex items-center gap-3">
                    <Toggle value={s.enabled !== false} onChange={(v) => updateSource(s.key, { enabled: v })} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-medium">{s.name}</span>
                        {s.builtin && <span className="rounded bg-[var(--brand-soft)] px-1.5 py-0.5 text-[10px] text-[var(--brand)]">内置</span>}
                        <span className="flex shrink-0 items-center gap-1.5 text-[11px]" style={{ color: stateColor(state) }}>
                          <span className={`h-1.5 w-1.5 rounded-full ${state === 'checking' ? 'animate-pulse' : ''}`} style={{ backgroundColor: stateColor(state) }} />
                          {stateLabel(state)}
                          {live && h?.ms ? <span className="text-[var(--muted)]">{formatMs(h.ms)}</span> : null}
                          {live && h?.count !== undefined ? <span className="text-[var(--muted)]">· {h.count} 条</span> : null}
                          {h?.failStreak && h.failStreak > 1 ? <span className="text-[var(--muted)]">· 连续 {h.failStreak} 次失败</span> : null}
                        </span>
                      </div>
                      <div className="truncate text-[11px] text-[var(--muted)]">{s.url}</div>
                    </div>
                    <button
                      className="btn btn-ghost h-7 w-7 p-0"
                      onClick={() => checkAll([s.key])}
                      title="立即检测该接口"
                      disabled={checking}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                    <button className="btn btn-ghost h-7 w-7 p-0" onClick={() => removeSource(s.key)} title="删除">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {state === 'offline' && h?.error && <div className="mt-1.5 text-[11px] text-red-400/80">{h.error}</div>}
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="名称，如：某某资源" className="input h-8 w-[150px] text-[12px]" />
            <input value={newUrl} onChange={(e) => setNewUrl(e.target.value)} placeholder="https://example.com/api.php/provide/vod" className="input h-8 min-w-[240px] flex-1 text-[12px]" />
            <button className="btn btn-primary h-8 px-3 text-[12px]" onClick={submitSource} disabled={!newName.trim() || !/^https?:\/\//i.test(newUrl.trim())}>
              <Plus className="h-3.5 w-3.5" /> 添加
            </button>
            <button
              className="btn btn-ghost h-8 px-3 text-[12px]"
              onClick={() => {
                if (window.confirm(`恢复为内置的 ${DEFAULT_SOURCES.length} 个数据源？自定义源将被移除。`)) resetSources();
              }}
            >
              <RotateCcw className="h-3.5 w-3.5" /> 恢复默认
            </button>
          </div>
        </Section>

        {FEATURES.live && (
        <Section title="直播源" icon={<Radio className="h-4 w-4" />} desc="M3U / M3U8 订阅地址">
          <div className="space-y-2">
            {liveSources.map((s) => (
              <div key={s.key} className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2.5">
                <Toggle value={s.enabled !== false} onChange={(v) => updateLiveSource(s.key, { enabled: v })} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-medium">{s.name}</span>
                    {s.builtin && <span className="rounded bg-[var(--brand-soft)] px-1.5 py-0.5 text-[10px] text-[var(--brand)]">内置</span>}
                  </div>
                  <div className="truncate text-[11px] text-[var(--muted)]">{s.url}</div>
                </div>
                <button className="btn btn-ghost h-7 w-7 p-0" onClick={() => removeLiveSource(s.key)} title="删除">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
            <input value={newLiveName} onChange={(e) => setNewLiveName(e.target.value)} placeholder="名称" className="input h-8 w-[130px] text-[12px]" />
            <input value={newLiveUrl} onChange={(e) => setNewLiveUrl(e.target.value)} placeholder="https://example.com/playlist.m3u" className="input h-8 min-w-[240px] flex-1 text-[12px]" />
            <button className="btn btn-primary h-8 px-3 text-[12px]" onClick={submitLive} disabled={!newLiveName.trim() || !/^https?:\/\//i.test(newLiveUrl.trim())}>
              <Plus className="h-3.5 w-3.5" /> 添加
            </button>
          </div>
        </Section>
        )}

        <Section
          title="内容分级"
          icon={<ShieldCheck className="h-4 w-4" />}
          desc="成人/伦理内容默认隐藏，开启后侧边栏会出现独立的 18+ 频道"
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-[13px]">18+ 内容</div>
              <div className="mt-0.5 text-[11.5px] text-[var(--muted)]">
                开启后可在 18+ 频道浏览与搜索成人内容，普通首页和搜索始终过滤相关内容。
              </div>
            </div>
            <Toggle
              testId="adult-toggle"
              value={settings.adult18}
              onChange={(v) => {
                if (v) setAdultConfirm(true);
                else updateSettings({ adult18: false });
              }}
            />
          </div>
          {settings.adult18 && (
            <div className="mt-3 rounded-xl border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-[11.5px] text-amber-300/90">
              18+ 频道已开启。相关筛选仅对本地展示生效，请遵守你所在地区的法律法规。
            </div>
          )}
        </Section>

        <Section title="关于" icon={<Info className="h-4 w-4" />} desc="聚影 TV · 本地优先的聚合影视客户端">
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[12px]">
            <div className="flex justify-between border-b border-[var(--border)] py-1.5">
              <span className="text-[var(--muted)]">版本</span>
              <span>{info?.version || '-'}</span>
            </div>
            <div className="flex justify-between border-b border-[var(--border)] py-1.5">
              <span className="text-[var(--muted)]">Electron</span>
              <span>{info?.electron || '-'}</span>
            </div>
            <div className="flex justify-between border-b border-[var(--border)] py-1.5">
              <span className="text-[var(--muted)]">Chromium</span>
              <span className="truncate pl-3">{info?.chrome || '-'}</span>
            </div>
            <div className="flex justify-between border-b border-[var(--border)] py-1.5">
              <span className="text-[var(--muted)]">平台</span>
              <span>{info?.platform || '-'}</span>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn btn-ghost h-8 px-3 text-[12px]" onClick={() => info?.userData && void api.app.openExternal(info.userData)}>
              <FolderOpen className="h-3.5 w-3.5" /> 数据目录
            </button>
            <button className="btn btn-ghost h-8 px-3 text-[12px]" onClick={() => void api.app.openExternal('https://github.com/LibreSpark/LibreTV')}>
              <ExternalLink className="h-3.5 w-3.5" /> 参考项目 LibreTV
            </button>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-[var(--muted)]">
            本软件仅聚合第三方公开的苹果CMS 采集接口，不存储、不托管任何视频内容，所有内容版权归原权利人所有。请遵守当地法律法规，仅用于个人学习与测试。
          </p>
        </Section>
      </div>

      <ConfirmModal
        open={adultConfirm}
        title="确认开启 18+ 内容？"
        description="18+ 频道包含成人、伦理类影视资源，仅限年满 18 周岁的成年人访问。开启前请确认你已年满 18 周岁，并了解并遵守所在地区的法律法规。"
        confirmLabel="我已年满 18 周岁，开启"
        cancelLabel="取消"
        onConfirm={() => {
          updateSettings({ adult18: true });
          setAdultConfirm(false);
        }}
        onCancel={() => setAdultConfirm(false)}
      >
        <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2.5 text-[11.5px] leading-relaxed text-[var(--muted)]">
          开启后：侧边栏新增「18+」入口；普通首页、搜索、短剧频道会自动过滤成人内容；18+ 频道的搜索记录与主站完全独立，可随时在设置中关闭并清除展示。
        </div>
      </ConfirmModal>
    </div>
  );
}

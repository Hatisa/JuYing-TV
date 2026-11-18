import { useEffect, useState, type ReactNode } from 'react';
import {
  Check,
  ChevronDown,
  ExternalLink,
  FolderOpen,
  Info,
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
import ConfirmModal from '../components/ConfirmModal';
import { PageHeader } from '../components/States';
import { api } from '../lib/bridge';
import { FEATURES } from '../lib/features';
import { DEFAULT_SOURCES } from '../lib/default-sources';
import { formatMs, relativeTime, stateColor, stateLabel, summarize } from '../lib/health';
import { useApp } from '../store/app';
import { useHealth } from '../store/health';
import type { AppInfo } from '../types';

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

  useEffect(() => {
    void api.app.info().then(setInfo).catch(() => {});
  }, []);

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

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Bot, ExternalLink, Film, Globe2, Loader2, Send, Sparkles, Trash2, User } from 'lucide-react';
import { Link } from 'react-router-dom';
import MediaCard from '../components/MediaCard';
import { PageHeader } from '../components/States';
import { aiMode, buildChatMessages, isAiUsable, parseAiReply, type AiRecommendation } from '../lib/ai';
import { lookupRecommendation, rankLookupSources, type AiLookupResult } from '../lib/ai-lookup';
import { api } from '../lib/bridge';
import { buildWebContext, isWebSearchUsable, webSearchProviderName } from '../lib/web-search';
import type { SearchGroup } from '../lib/rank';
import { useApp } from '../store/app';
import { useHealth } from '../store/health';
import type { AiChatMessage, WebSearchResult } from '../types';

type RecState = 'loading' | 'ready' | 'empty' | 'error';

interface RecView extends AiRecommendation {
  key: string;
  state: RecState;
  group?: SearchGroup;
  error?: string;
  viaOriginal?: boolean;
}

interface ChatRoute {
  provider?: string;
  model?: string;
  auto?: boolean;
  attempts?: number;
}

interface ChatEntry {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  recs: RecView[];
  pending?: boolean;
  error?: string;
  route?: ChatRoute;
  keywords?: string[];
  retryText?: string;
  web?: WebSearchResult;
  phase?: 'searching' | 'thinking';
}

const EXAMPLES = [
  '一个和尚去取经，路上打怪升级，还有四个徒弟和各种神仙妖魔',
  '几个年轻人进入梦境，一层一层往下掉，最后陀螺一直转',
  '一个程序员发现世界是虚拟的，有人给他红色药丸和蓝色药丸',
];

const CONFIDENCE_LABEL: Record<AiRecommendation['confidence'], string> = {
  high: '很可能',
  medium: '可能是',
  low: '待确认',
};

function entryHistoryText(entry: ChatEntry): string {
  if (entry.role === 'user') return entry.content;
  const titles = entry.recs.map((r) => r.title).filter(Boolean);
  return entry.content + (titles.length ? '\n（当时推荐的片名：' + titles.join('、') + '）' : '');
}

function RecCard({ rec, proxy }: { rec: RecView; proxy: ReturnType<typeof useApp.getState>['proxy'] }) {
  if (rec.state === 'loading') {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-2" data-testid="ai-rec-loading">
        <div className="skeleton aspect-[2/3] rounded-lg" />
        <div className="skeleton mt-2.5 h-3.5 w-4/5 rounded" />
        <div className="skeleton mt-2 h-3 w-1/2 rounded" />
        <div className="mt-2 flex items-center gap-1.5 text-[10.5px] text-[var(--muted)]">
          <Loader2 className="h-3 w-3 animate-spin" /> 正在片库中查找…
        </div>
      </div>
    );
  }

  if (!rec.group) {
    const failed = rec.state === 'error';
    return (
      <div className="flex flex-col rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-3" data-testid="ai-rec-empty">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--muted)]">
          <Film className="h-3.5 w-3.5" />
          {failed ? '片库检索失败' : '片库暂未找到'}
        </div>
        <div className="mt-1.5 line-2 text-[12.5px] font-medium">{rec.title}</div>
        <div className="mt-1 text-[10.5px] leading-relaxed text-[var(--muted)]">
          {failed ? rec.error || '所有数据源都没有响应，请稍后重试' : '当前启用的数据源里没有匹配条目，可以换个片名或去全站搜索。'}
        </div>
        <Link
          to={'/search?wd=' + encodeURIComponent(rec.title)}
          className="btn btn-ghost mt-2.5 h-7 justify-center px-2 text-[11px]"
        >
          去搜索《{rec.title}》
        </Link>
      </div>
    );
  }

  const item = rec.group.rating ? { ...rec.group.primary, rating: rec.group.rating } : rec.group.primary;
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-2" data-testid="ai-recommendation">
      <MediaCard item={item} proxy={proxy} sourceCount={rec.group.sourceCount} />
      <div className="mt-2 flex flex-wrap items-center gap-1.5 px-0.5 text-[10px]">
        <span className="rounded bg-[var(--brand-soft)] px-1.5 py-0.5 font-medium text-[var(--brand)]">
          {CONFIDENCE_LABEL[rec.confidence]}
        </span>
        {rec.year && <span className="text-[var(--muted)]">{rec.year}</span>}
        {rec.viaOriginal && <span className="text-[var(--muted)]">原名命中</span>}
      </div>
      <p className="mt-1.5 line-3 px-0.5 text-[10.5px] leading-relaxed text-[var(--muted)]">{rec.reason}</p>
    </div>
  );
}

export default function AssistantPage() {
  const settings = useApp((s) => s.settings);
  const sources = useApp((s) => s.sources);
  const proxy = useApp((s) => s.proxy);
  const statuses = useHealth((s) => s.statuses);

  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const aiModeValue = aiMode(settings.ai);
  const configured = isAiUsable(settings.ai);
  const webReady = isWebSearchUsable(settings.webSearch);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [entries]);

  const patchRec = (assistantId: string, key: string, patch: Partial<RecView>) => {
    setEntries((prev) =>
      prev.map((entry) =>
        entry.id === assistantId
          ? { ...entry, recs: entry.recs.map((rec) => (rec.key === key ? { ...rec, ...patch } : rec)) }
          : entry
      )
    );
  };

  const resolveRecommendations = async (assistantId: string, recs: RecView[]) => {
    const pool = rankLookupSources(sources, statuses, 12);
    const outcomes = new Map<string, AiLookupResult>();
    const queue = recs.slice(0, 5);
    let cursor = 0;

    const worker = async () => {
      while (cursor < queue.length) {
        const rec = queue[cursor];
        cursor += 1;
        try {
          const result = await lookupRecommendation(rec, pool, {
            allowAdult: settings.adult18,
            timeoutMs: 6000,
          });
          outcomes.set(rec.key, result);
          if (result.group) patchRec(assistantId, rec.key, { state: 'ready', group: result.group, viaOriginal: result.viaOriginal });
          else if (result.error) patchRec(assistantId, rec.key, { state: 'error', error: result.error });
          else patchRec(assistantId, rec.key, { state: 'empty' });
        } catch (err: any) {
          outcomes.set(rec.key, { error: err?.message || '片库检索失败' });
          patchRec(assistantId, rec.key, { state: 'error', error: err?.message || '片库检索失败' });
        }
      }
    };

    await Promise.all([worker(), worker()]);

    const titles = Array.from(
      new Set(
        queue
          .map((rec) => outcomes.get(rec.key)?.group?.title)
          .filter((title): title is string => !!title)
      )
    ).slice(0, 30);
    if (titles.length === 0) return;
    try {
      const ratings = await api.douban.ratings(titles);
      if (Object.keys(ratings).length === 0) return;
      setEntries((prev) =>
        prev.map((entry) => {
          if (entry.id !== assistantId) return entry;
          return {
            ...entry,
            recs: entry.recs.map((rec) => {
              if (!rec.group) return rec;
              const hit = ratings[rec.group.title] || ratings[rec.title];
              if (!hit) return rec;
              return {
                ...rec,
                group: {
                  ...rec.group,
                  rating: hit.rating ?? rec.group.rating,
                  doubanType: hit.type ?? rec.group.doubanType,
                  doubanId: hit.id ?? rec.group.doubanId,
                },
              };
            }),
          };
        })
      );
    } catch {
      /* 豆瓣评分失败不影响推荐展示 */
    }
  };

  const send = async (raw?: string) => {
    const text = String(raw ?? input).trim();
    if (!text || sending || !configured) return;

    const history: AiChatMessage[] = entries
      .filter((entry) => entry.content.trim() && !entry.pending)
      .map((entry) => ({ role: entry.role, content: entryHistoryText(entry).slice(0, 4000) }));
    const userId = 'u_' + Date.now().toString(36);
    const assistantId = 'a_' + Date.now().toString(36);
    const userEntry: ChatEntry = { id: userId, role: 'user', content: text, recs: [] };
    const assistantEntry: ChatEntry = { id: assistantId, role: 'assistant', content: '', recs: [], pending: true };

    setEntries((prev) => [...prev, userEntry, assistantEntry]);
    setInput('');
    setSending(true);

    let web: WebSearchResult | undefined;
    try {
      if (webReady) {
        setEntries((prev) =>
          prev.map((entry) => (entry.id === assistantId ? { ...entry, phase: 'searching' } : entry))
        );
        try {
          web = await api.websearch.query(text, settings.webSearch);
        } catch {
          /* 联网搜索失败不阻断 AI 推荐 */
        }
        setEntries((prev) =>
          prev.map((entry) => (entry.id === assistantId ? { ...entry, web, phase: 'thinking' } : entry))
        );
      }
      const webContext = buildWebContext(web);
      let res = await api.ai.chat({
        messages: buildChatMessages(history, text, { webContext }),
        config: settings.ai,
      });
      if (!res.ok) throw new Error(res.error || 'AI 请求失败');
      let parsed = parseAiReply(res.content || '');
      const incomplete = parsed.recommendations.length === 0 && parsed.keywords.length === 0;
      if (incomplete) {
        // 空回复、损坏 JSON 或只给了一段没有片名的闲聊：用更严格的修复提示再请求一次
        const repair = await api.ai.chat({
          messages: buildChatMessages(
            history,
            text +
              '\n\n上一次输出无法解析。请严格按要求只输出 JSON：reply、searchKeywords、recommendations；即使不确定也给 1-3 个可检索片名。',
            { webContext }
          ),
          config: settings.ai,
        });
        if (!repair.ok && !parsed.reply.trim()) {
          throw new Error(repair.error || '模型没有返回有效内容，请再试一次');
        }
        if (repair.ok) {
          const repaired = parseAiReply(repair.content || '');
          const repairedUseful = repaired.recommendations.length > 0 || repaired.keywords.length > 0;
          if (repairedUseful || (!parsed.reply.trim() && repaired.reply.trim())) {
            res = repair;
            parsed = repaired;
          }
        }
      }
      if (!parsed.reply.trim() && parsed.recommendations.length === 0 && parsed.keywords.length === 0) {
        throw new Error('模型没有返回有效内容，请再试一次');
      }
      const recs: RecView[] = parsed.recommendations.map((rec, index) => ({
        ...rec,
        key: assistantId + '_' + index,
        state: 'loading',
      }));
      const keywords = Array.from(
        new Set([...parsed.keywords, ...parsed.recommendations.map((rec) => rec.title)].map((k) => k.trim()).filter(Boolean))
      ).slice(0, 4);
      setEntries((prev) =>
        prev.map((entry) =>
          entry.id === assistantId
            ? {
                ...entry,
                content: parsed.reply,
                recs,
                keywords,
                pending: false,
                phase: undefined,
                web,
                route: { provider: res.provider, model: res.model, auto: res.auto, attempts: res.attempts },
              }
            : entry
        )
      );
      if (recs.length > 0) void resolveRecommendations(assistantId, recs);
    } catch (err: any) {
      const message = err?.message || 'AI 请求失败';
      const hint =
        aiModeValue === 'auto'
          ? '这次没能从免费模型拿到推荐结果。可以稍后重试，或到设置中一键签到、检测免费模型。'
          : '这次没能拿到推荐结果。请检查设置中的 API 地址、模型和密钥是否正确，或稍后重试。';
      setEntries((prev) =>
        prev.map((entry) =>
          entry.id === assistantId
            ? { ...entry, pending: false, phase: undefined, web, error: message, content: hint, retryText: text }
            : entry
        )
      );
    } finally {
      setSending(false);
    }
  };

  const clear = () => {
    if (sending) return;
    setEntries([]);
    setInput('');
  };

  return (
    <div className="flex h-[calc(100vh-112px)] min-h-[480px] flex-col px-7 py-6" data-testid="ai-page">
      <PageHeader
        title="AI 助手"
        subtitle="描述你记得的剧情、角色或台词，我来帮你找片"
        right={
          <button className="btn btn-ghost h-8 px-3 text-[12px]" onClick={clear} disabled={sending || entries.length === 0}>
            <Trash2 className="h-3.5 w-3.5" /> 清空对话
          </button>
        }
      />

      <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel)]">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
          {!configured && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-400/25 bg-amber-400/5 px-3.5 py-2.5 text-[12px] text-amber-300/90">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>还没有配置 AI 模型。先填写供应商 API 地址、模型和密钥，才能开始推荐。</span>
              <Link to="/settings" className="btn btn-primary ml-auto h-7 px-2.5 text-[11px]">
                去设置
              </Link>
            </div>
          )}

          {webReady && (
            <div
              data-testid="ai-web-banner"
              className="flex flex-wrap items-center gap-2 rounded-xl border border-sky-400/20 bg-sky-400/5 px-3.5 py-2 text-[11.5px] text-sky-300/90"
            >
              <Globe2 className="h-3.5 w-3.5 shrink-0" />
              <span>联网搜索已开启 · {webSearchProviderName(settings.webSearch.provider)}，回答前会先搜索网页并列出参考来源。</span>
              <Link to="/settings" className="ml-auto text-[11px] underline decoration-dotted underline-offset-2">
                搜索设置
              </Link>
            </div>
          )}

          {configured && aiModeValue === 'auto' && (
            <div
              data-testid="ai-auto-banner"
              className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/5 px-3.5 py-2 text-[11.5px] text-emerald-300/90"
            >
              <Sparkles className="h-3.5 w-3.5 shrink-0" />
              <span>免费 Auto 模式：无需 API Key，自动选择可用模型，繁忙时自动切换。</span>
              <Link to="/settings" className="ml-auto text-[11px] underline decoration-dotted underline-offset-2">
                签到 / 检测
              </Link>
            </div>
          )}

          {entries.length === 0 ? (
            <div className="flex flex-col items-center px-2 py-8 text-center" data-testid="ai-empty">
              <div className="grid h-14 w-14 place-items-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand)]">
                <Sparkles className="h-7 w-7" />
              </div>
              <h2 className="mt-3 text-[17px] font-semibold">说说你记得的剧情</h2>
              <p className="mt-1.5 max-w-lg text-[12px] leading-relaxed text-[var(--muted)]">
                不用记片名。哪怕只记得一个角色、一段画面或一句台词，也可以描述给我。我会先猜作品，再到你启用的数据源里找能播放的版本。
              </p>
              <div className="mt-5 grid w-full max-w-2xl gap-2 sm:grid-cols-3">
                {EXAMPLES.map((example) => (
                  <button
                    key={example}
                    type="button"
                    className="rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-3 text-left text-[11.5px] leading-relaxed text-[var(--muted)] transition-colors hover:border-[var(--brand)] hover:text-[var(--text)]"
                    onClick={() => {
                      setInput(example);
                      void send(example);
                    }}
                    disabled={!configured || sending}
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            entries.map((entry) => (
              <div
                key={entry.id}
                className={'flex gap-2.5 ' + (entry.role === 'user' ? 'justify-end' : 'justify-start')}
                data-testid={'ai-message-' + entry.role}
              >
                {entry.role === 'assistant' && (
                  <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[var(--brand-soft)] text-[var(--brand)]">
                    <Bot className="h-4 w-4" />
                  </div>
                )}
                <div className={entry.role === 'user' ? 'max-w-[85%]' : 'min-w-0 max-w-[92%] flex-1'}>
                  <div
                    className={
                      entry.role === 'user'
                        ? 'rounded-2xl rounded-br-md bg-[var(--brand)] px-3.5 py-2.5 text-[13px] leading-relaxed text-white'
                        : 'rounded-2xl rounded-tl-md border border-[var(--border)] bg-[var(--panel-2)] px-3.5 py-2.5 text-[13px] leading-relaxed'
                    }
                  >
                    {entry.pending ? (
                      <span className="flex items-center gap-2 text-[12px] text-[var(--muted)]">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        {entry.phase === 'searching' ? '正在联网搜索…' : '正在理解你的描述并生成推荐…'}
                      </span>
                    ) : (
                      <div className="whitespace-pre-wrap break-words">{entry.content}</div>
                    )}
                    {entry.error && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-red-400/20 bg-red-400/5 px-2 py-1.5 text-[11px] text-red-400">
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        <span className="min-w-0 flex-1 break-words">{entry.error}</span>
                        {entry.retryText && (
                          <button
                            type="button"
                            data-testid="ai-retry"
                            className="btn btn-ghost h-6 shrink-0 px-2 text-[10.5px]"
                            onClick={() => void send(entry.retryText)}
                            disabled={sending}
                          >
                            重试
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {entry.route && (
                    <div
                      data-testid="ai-route"
                      className="mt-1.5 flex flex-wrap items-center gap-1.5 px-1 text-[10.5px] text-[var(--muted)]"
                    >
                      <span className="rounded bg-[var(--brand-soft)] px-1.5 py-0.5 text-[var(--brand)]">
                        {entry.route.auto ? '免费模式 · Auto' : '自定义 API'}
                      </span>
                      {entry.route.provider && (
                        <span>
                          {entry.route.provider === 'kilo'
                            ? 'Kilo'
                            : entry.route.provider === 'pollinations'
                              ? 'Pollinations'
                              : entry.route.provider === 'custom'
                                ? '自定义通道'
                                : entry.route.provider}
                        </span>
                      )}
                      {entry.route.model && <span className="font-mono">{entry.route.model}</span>}
                      {!!entry.route.attempts && entry.route.attempts > 1 && <span>· 第 {entry.route.attempts} 次尝试</span>}
                    </div>
                  )}

                  {entry.web && (
                    <div
                      data-testid="ai-web-sources"
                      className="mt-1.5 flex flex-wrap items-center gap-1.5 px-1 text-[10.5px] text-[var(--muted)]"
                    >
                      <Globe2 className="h-3 w-3 shrink-0" />
                      <span className="shrink-0">{webSearchProviderName(entry.web.provider)}</span>
                      {entry.web.ok && entry.web.results.length > 0 ? (
                        entry.web.results.slice(0, 3).map((item) => (
                          <a
                            key={item.url}
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            data-testid="ai-web-source"
                            className="max-w-[220px] truncate rounded bg-[var(--panel)] px-1.5 py-0.5 underline decoration-dotted underline-offset-2 hover:text-[var(--text)]"
                            title={item.title + '\n' + item.url}
                            onClick={(e) => {
                              e.preventDefault();
                              void api.app.openExternal(item.url);
                            }}
                          >
                            {item.title} <ExternalLink className="inline h-2.5 w-2.5" />
                          </a>
                        ))
                      ) : (
                        <span className="text-amber-400/80">
                          {entry.web.error || '没有可用的搜索结果'}，已直接使用模型推荐
                        </span>
                      )}
                    </div>
                  )}

                  {!!entry.keywords?.length && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 px-1" data-testid="ai-search-keywords">
                      <span className="text-[10.5px] text-[var(--muted)]">查看更多搜索结果：</span>
                      {entry.keywords.map((keyword) => (
                        <Link
                          key={keyword}
                          to={'/search?wd=' + encodeURIComponent(keyword)}
                          data-testid="ai-search-keyword"
                          className="chip text-[11px]"
                          title={'搜索《' + keyword + '》'}
                        >
                          《{keyword}》
                        </Link>
                      ))}
                    </div>
                  )}

                  {entry.recs.length > 0 && (
                    <div className="mt-2.5 grid grid-cols-2 gap-2.5 sm:grid-cols-3" data-testid="ai-recommendations">
                      {entry.recs.map((rec) => (
                        <RecCard key={rec.key} rec={rec} proxy={proxy} />
                      ))}
                    </div>
                  )}
                </div>
                {entry.role === 'user' && (
                  <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[var(--panel-2)] text-[var(--muted)]">
                    <User className="h-4 w-4" />
                  </div>
                )}
              </div>
            ))
          )}
          <div ref={endRef} />
        </div>

        <div className="border-t border-[var(--border)] p-3">
          <div className="flex items-end gap-2 rounded-2xl border border-[var(--border)] bg-[var(--panel-2)] p-1.5 focus-within:border-[var(--brand)]">
            <textarea
              data-testid="ai-input"
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              disabled={!configured || sending}
              placeholder={
                configured
                  ? aiModeValue === 'auto'
                    ? '例如：一个和尚去取经，路上打怪升级，还有四个徒弟……'
                    : '例如：一个和尚去取经，路上打怪升级，还有四个徒弟……'
                  : '请先在设置中配置 AI 模型'
              }
              className="max-h-32 min-h-[38px] flex-1 resize-none bg-transparent px-2 py-2 text-[13px] leading-relaxed outline-none placeholder:text-[var(--muted)] disabled:opacity-60"
            />
            <button
              type="button"
              data-testid="ai-send"
              className="btn btn-primary h-9 w-9 shrink-0 rounded-xl p-0"
              onClick={() => void send()}
              disabled={!configured || sending || !input.trim()}
              title="发送"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
          <div className="mt-1.5 flex items-center justify-between px-1 text-[10.5px] text-[var(--muted)]">
            <span>Enter 发送 · Shift+Enter 换行</span>
            <span>
              {aiModeValue === 'auto' ? '免费 Auto · 自动选择可用模型' : 'AI 推荐仅供参考，请以片库实际结果为准'}
              {webReady ? ' · 联网搜索' : ''}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

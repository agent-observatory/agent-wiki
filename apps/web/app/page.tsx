"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import ThemeToggle from "./theme-toggle";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  BookOpen,
  Search,
  Plus,
  ArrowUpRight,
  FileText,
  Terminal,
  Upload,
  KeyRound,
  LogOut,
  Check,
  ChevronRight,
  Layers,
  Link,
  History,
  PanelLeft,
  Trash2,
  Pencil,
  Copy,
  X,
} from "lucide-react";
type Workspace = { id: string; name: string };
type Article = {
  id: string;
  title: string;
  content: string;
  kind: string;
  folder: string;
  tags: string[];
  aliases: string[];
  revision: number;
  updated_at: string;
  source_id?: string;
  evidence_status: string;
  revisions?: { revision: number; title: string; created_at: string }[];
  links?: { to_id: string; title: string; relation: string }[];
};
type Source = {
  id: string;
  name: string;
  status: string;
  error_code?: string;
  model?: string;
  attempt: number;
};
const messages: Record<string, string> = {
  REVISION_CONFLICT:
    "다른 곳에서 문서가 변경됐어요. 현재 문서를 다시 열고 편집해 주세요.",
  ORIGIN_REJECTED: "요청 출처를 확인할 수 없어요. 새로고침해 주세요.",
  MODEL_KEY_MISSING: "AI 연결 설정을 확인해 주세요.",
  INVALID_INPUT: "입력 길이와 필수 항목을 확인해 주세요.",
  LOGIN_REQUIRED: "로그인이 필요해요.",
  SESSION_EXPIRED: "로그인이 만료됐어요. 다시 로그인해 주세요.",
};
async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const safe = !options.method || options.method === "GET";
  const deadline = AbortSignal.timeout(12000);
  const signal = options.signal
    ? AbortSignal.any([options.signal, deadline])
    : deadline;
  for (let attempt = 0; ; attempt++) {
    let r: Response;
    try {
      r = await fetch(url, {
        ...options,
        signal,
        headers: { "Content-Type": "application/json", ...options.headers },
      });
    } catch (error) {
      if (!safe || attempt >= 2 || signal.aborted) throw error;
      await new Promise((resolve) =>
        setTimeout(resolve, 250 * 2 ** attempt + Math.random() * 150),
      );
      continue;
    }
    if (
      safe &&
      [502, 503, 504].includes(r.status) &&
      attempt < 2 &&
      !signal.aborted
    ) {
      await r.body?.cancel();
      await new Promise((resolve) =>
        setTimeout(resolve, 250 * 2 ** attempt + Math.random() * 150),
      );
      continue;
    }
    const data = await r
      .json()
      .catch(() => ({ error: "잠시 연결할 수 없어요. 다시 시도해 주세요." }));
    if (!r.ok)
      throw new Error(
        messages[data.error] ?? data.error ?? "요청을 처리하지 못했어요.",
      );
    return data;
  }
}
const date = (value: string) =>
  new Date(value).toLocaleDateString("ko-KR", {
    month: "short",
    day: "numeric",
  });
const typeName = (kind: string) =>
  ({ article: "문서", memory: "기억", glossary: "용어" })[kind] ?? kind;
const evidence = (status: string) =>
  ({
    user_authored: "직접 작성",
    user_confirmed: "사용자 결정",
    observation: "관찰",
    ai_inferred: "AI 정리 · 확인 필요",
    unverified: "미확인",
  })[status] ?? status;
export default function Wiki() {
  const [user, setUser] = useState<{ login: string } | null>(null),
    [ready, setReady] = useState(false),
    [spaces, setSpaces] = useState<Workspace[]>([]),
    [ws, setWs] = useState(""),
    [articles, setArticles] = useState<Article[]>([]),
    [selected, setSelected] = useState<Article | null>(null),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState(""),
    [folder, setFolder] = useState(""),
    [tag, setTag] = useState(""),
    [view, setView] = useState("wiki"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState(false),
    [draft, setDraft] = useState({
      title: "",
      content: "",
      kind: "article",
      folder: "",
      tags: "",
      aliases: "",
    }),
    [sources, setSources] = useState<Source[]>([]),
    [modal, setModal] = useState<
      "workspace" | "source" | "context" | "key" | null
    >(null),
    [input, setInput] = useState(""),
    [sourceText, setSourceText] = useState(""),
    [allowed, setAllowed] = useState(false),
    [context, setContext] = useState(""),
    [keys, setKeys] = useState<{ id: string; name: string; scope: string }[]>(
      [],
    ),
    [keyScope, setKeyScope] = useState("read"),
    [newKey, setNewKey] = useState(""),
    [copied, setCopied] = useState(false),
    [history, setHistory] = useState(false),
    [sourcePreview, setSourcePreview] = useState<{
      name: string;
      text: string;
    } | null>(null);
  const generation = useRef(0);
  const base = "/api/workspaces/" + ws;
  const loadSpaces = useCallback(async () => {
    const result = await request<{ items: Workspace[] }>("/api/workspaces");
    setSpaces(result.items);
    setWs(
      (current) =>
        current ||
        new URLSearchParams(location.search).get("workspace") ||
        result.items[0]?.id ||
        "",
    );
  }, []);
  useEffect(() => {
    request<{ user: { login: string } }>("/api/me")
      .then((r) => {
        setUser(r.user);
        return loadSpaces();
      })
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, [loadSpaces]);
  useEffect(() => {
    generation.current++;
    setSelected(null);
    setEditing(false);
    setArticles([]);
    setQuery("");
    setFolder("");
    setTag("");
    setContext("");
    setSourcePreview(null);
    setNewKey("");
  }, [ws]);
  const load = useCallback(async () => {
    if (!ws) return;
    const gen = generation.current;
    const qs = new URLSearchParams({
      q: query,
      ...(filter ? { kind: filter } : {}),
      ...(folder ? { folder } : {}),
      ...(tag ? { tag } : {}),
    });
    try {
      const r = await request<{ items: Article[] }>(base + "/articles?" + qs);
      if (gen === generation.current) setArticles(r.items);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [ws, base, query, filter, folder, tag]);
  useEffect(() => {
    const timer = setTimeout(load, 180);
    return () => clearTimeout(timer);
  }, [load]);
  const loadSources = useCallback(async () => {
    if (!ws) return;
    const gen = generation.current;
    const r = await request<{ items: Source[] }>(base + "/sources");
    if (gen === generation.current) setSources(r.items);
  }, [ws, base]);
  useEffect(() => {
    if (view !== "sources") return;
    loadSources().catch((e) => setError(e.message));
    const timer = setInterval(() => loadSources().catch(() => {}), 8000);
    return () => clearInterval(timer);
  }, [view, loadSources]);
  useEffect(() => {
    if (view === "keys" && ws)
      request<{ items: typeof keys }>(base + "/keys")
        .then((r) => setKeys(r.items))
        .catch((e) => setError(e.message));
  }, [view, ws, base]);
  async function openArticle(id: string) {
    setError("");
    const gen = generation.current;
    try {
      const a = await request<Article>(base + "/articles/" + id);
      if (gen !== generation.current) return;
      setSelected(a);
      setEditing(false);
      setHistory(false);
      setSourcePreview(null);
      const url = new URL(location.href);
      url.searchParams.set("workspace", ws);
      url.searchParams.set("article", id);
      window.history.replaceState({}, "", url);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("article");
    if (ws && id) openArticle(id);
  }, [ws]); // Initial deep link is scoped by the API.
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  function newArticle() {
    setSelected(null);
    setDraft({
      title: "",
      content: "",
      kind: "article",
      folder: "",
      tags: "",
      aliases: "",
    });
    setEditing(true);
    setView("wiki");
  }
  async function save() {
    await act(async () => {
      const payload = {
        ...draft,
        tags: draft.tags
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
        aliases: draft.aliases
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
        ...(selected ? { revision: selected.revision } : {}),
      };
      const a = await request<Article>(
        base + "/articles" + (selected ? "/" + selected.id : ""),
        { method: selected ? "PUT" : "POST", body: JSON.stringify(payload) },
      );
      setSelected(a);
      setEditing(false);
      await load();
    });
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("복사하지 못했어요. 내용을 선택해 복사해 주세요.");
    }
  }
  const currentSpace = spaces.find((s) => s.id === ws);
  if (!ready)
    return (
      <main className="welcome">
        <div className="brand">
          <BookOpen /> Agent Wiki
        </div>
        <p>지식 공간을 불러오는 중…</p>
      </main>
    );
  if (!user)
    return (
      <main className="landing">
        <div className="brand">
          <BookOpen /> Agent Wiki <span className="pill">개인 위키</span>
          <ThemeToggle />
        </div>
        <div className="landing-grid">
          <section>
            <p className="eyebrow">CONTEXT THAT STAYS WITH YOU</p>
            <h1>
              다음 작업에도,
              <br />
              이전의 맥락을.
            </h1>
            <p className="lede">
              흩어진 기록을 연결하고, 결정의 근거를 찾으세요.
              <br />
              당신의 에이전트와 함께 사용하는 지식 공간입니다.
            </p>
            <a className="button primary" href="/api/auth/github">
              소유자 GitHub 로그인 <ArrowUpRight size={18} />
            </a>
            <p className="muted small">
              소유자 전용 공간이에요. 다른 계정의 가입은 받지 않아요.
            </p>
          </section>
          <div className="sample">
            <div className="sample-top">
              <Terminal size={18} /> YOUR AGENT{" "}
              <span className="live">● CONTEXT READY</span>
            </div>
            <p className="question">“이 프로젝트에서 결정한 게 뭐였지?”</p>
            <div className="source-card">
              <span className="eyebrow">01 / RETRIEVED KNOWLEDGE</span>
              <h3>결정과 제약, 출처까지 한 번에</h3>
              <p>
                관련 기록을 찾아 현재 에이전트의 작업에 필요한 맥락으로
                전달합니다.
              </p>
              <div className="tags">
                <span>문서</span>
                <span>개정</span>
                <span>원천 자료</span>
              </div>
            </div>
            <div className="sample-footer">
              <Link size={15} /> 지식의 출처를 따라갈 수 있는 연결
            </div>
          </div>
        </div>
        <footer>
          수집 → 지식 → 근거 조회 <span>Agent Wiki · 첫 번째 버전</span>
        </footer>
      </main>
    );
  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <BookOpen size={23} /> Agent Wiki
        </div>
        <div className="workspace-label">
          WORKSPACE{" "}
          <button
            className="icon"
            title="공간 추가"
            onClick={() => {
              setInput("");
              setModal("workspace");
            }}
          >
            <Plus size={16} />
          </button>
        </div>
        <select
          aria-label="Workspace"
          value={ws}
          onChange={(e) => {
            generation.current++;
            setSelected(null);
            setArticles([]);
            setEditing(false);
            setSources([]);
            setKeys([]);
            setModal(null);
            setWs(e.target.value);
          }}
        >
          <option value="" disabled>
            공간을 선택하세요
          </option>
          {spaces.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <nav>
          {[
            ["wiki", "지식 공간", BookOpen],
            ["sources", "원천 자료", Upload],
            ["keys", "에이전트 연결", Terminal],
          ].map(([id, label, Icon]) => (
            <button
              key={String(id)}
              className={view === id ? "active" : ""}
              onClick={() => {
                setView(String(id));
                setError("");
              }}
            >
              <Icon size={18} />
              {String(label)}
              <ChevronRight size={14} />
            </button>
          ))}
        </nav>
        <div className="side-note">
          <Layers size={18} />
          <p>
            기록은 쌓고,
            <br />
            맥락은 이어가세요.
          </p>
          <span>
            공간마다 자료와 검색이
            <br />
            독립적으로 유지됩니다.
          </span>
        </div>
        <div className="profile">
          <div className="avatar">{user.login[0].toUpperCase()}</div>
          <span>{user.login}</span>
          <button
            className="icon"
            title="로그아웃"
            onClick={() =>
              act(async () => {
                await request("/api/auth/logout", {
                  method: "POST",
                  body: "{}",
                });
                location.reload();
              })
            }
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <main className="main">
        <header>
          <div className="breadcrumb">
            <span title={currentSpace?.name}>
              {currentSpace?.name ?? "나의 공간"}
            </span>{" "}
            <ChevronRight size={14} />
            <b>
              {view === "wiki"
                ? "지식 공간"
                : view === "sources"
                  ? "원천 자료"
                  : "에이전트 연결"}
            </b>
          </div>
          <div className="header-actions">
            <span className="pill">
              <span className="dot" /> 개인 위키
            </span>
            <ThemeToggle />
          </div>
        </header>
        {error && (
          <div role="alert" className="alert">
            {error}
            <button className="icon" onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {!ws ? (
          <section className="empty-page">
            <Layers size={44} />
            <h1>첫 지식 공간을 만들어 보세요</h1>
            <p>업무와 취미, 서로 다른 맥락은 공간을 나눠 관리해요.</p>
            <button
              className="button primary"
              onClick={() => {
                setInput("");
                setModal("workspace");
              }}
            >
              Workspace 만들기 <Plus size={17} />
            </button>
          </section>
        ) : (
          <>
            {view === "wiki" && (
              <>
                <section className="page-heading">
                  <div>
                    <p className="eyebrow">YOUR KNOWLEDGE, CONNECTED</p>
                    <h1>지식 공간</h1>
                    <p>쌓아 둔 기록에서 다음 작업의 근거를 찾아보세요.</p>
                  </div>
                  <button className="button primary" onClick={newArticle}>
                    <Plus size={17} /> 새 문서
                  </button>
                </section>
                <div className="toolbar">
                  <label className="search">
                    <Search size={18} />
                    <input
                      aria-label="지식 검색"
                      placeholder="키워드, 제목, 별칭으로 찾기"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    <kbd>검색</kbd>
                  </label>
                  <button
                    className="button"
                    disabled={!query || busy}
                    onClick={() =>
                      act(async () => {
                        const c = await request(
                          base + "/context?q=" + encodeURIComponent(query),
                        );
                        setContext(JSON.stringify(c, null, 2));
                        setModal("context");
                      })
                    }
                  >
                    <Terminal size={17} /> 근거 Context
                  </button>
                </div>
                <div className="filters">
                  <div className="tabs">
                    {[
                      ["", "전체"],
                      ["article", "문서"],
                      ["memory", "기억"],
                      ["glossary", "용어"],
                    ].map(([id, n]) => (
                      <button
                        key={id}
                        className={filter === id ? "chosen" : ""}
                        onClick={() => setFilter(id)}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  <input
                    aria-label="폴더 필터"
                    placeholder="폴더"
                    value={folder}
                    onChange={(e) => setFolder(e.target.value)}
                  />
                  <input
                    aria-label="태그 필터"
                    placeholder="태그"
                    value={tag}
                    onChange={(e) => setTag(e.target.value)}
                  />
                  <span className="muted small">
                    {articles.length}개의 기록
                  </span>
                </div>
                <div className="knowledge-grid">
                  <section className="article-list">
                    {articles.length === 0 ? (
                      <div className="empty">
                        <FileText />
                        <h3>
                          {query
                            ? "일치하는 기록이 없어요"
                            : "아직 기록이 없어요"}
                        </h3>
                        <p>
                          {query
                            ? "다른 키워드나 용어 별칭으로 찾아보세요."
                            : "첫 문서를 쓰거나 원천 자료를 추가해 보세요."}
                        </p>
                      </div>
                    ) : (
                      articles.map((a) => (
                        <button
                          key={a.id}
                          className={
                            "article-card " +
                            (selected?.id === a.id ? "selected" : "")
                          }
                          onClick={() => openArticle(a.id)}
                        >
                          <div className="card-meta">
                            <span>{typeName(a.kind)}</span>
                            <span>{date(a.updated_at)}</span>
                          </div>
                          <h3>{a.title}</h3>
                          <p>
                            {a.content.replace(/[#>*`\[\]]/g, "").slice(0, 105)}
                          </p>
                          <div className="tags">
                            {a.tags.slice(0, 3).map((t) => (
                              <span key={t}>#{t}</span>
                            ))}
                            <small>r{a.revision}</small>
                          </div>
                        </button>
                      ))
                    )}
                  </section>
                  <section className="reader">
                    {editing ? (
                      <>
                        <div className="reader-top">
                          <span className="eyebrow">
                            {selected ? "EDIT DOCUMENT" : "NEW DOCUMENT"}
                          </span>
                          <div>
                            <button
                              className="button"
                              onClick={() => setEditing(false)}
                            >
                              취소
                            </button>
                            <button
                              className="button primary"
                              disabled={busy || !draft.title.trim()}
                              onClick={save}
                            >
                              {busy ? "저장 중…" : "저장"}
                            </button>
                          </div>
                        </div>
                        <input
                          className="title-input"
                          aria-label="문서 제목"
                          placeholder="문서 제목"
                          value={draft.title}
                          onChange={(e) =>
                            setDraft({ ...draft, title: e.target.value })
                          }
                        />
                        <div className="edit-meta">
                          <select
                            aria-label="문서 종류"
                            value={draft.kind}
                            onChange={(e) =>
                              setDraft({ ...draft, kind: e.target.value })
                            }
                          >
                            <option value="article">문서</option>
                            <option value="memory">기억</option>
                            <option value="glossary">용어</option>
                          </select>
                          <input
                            aria-label="폴더"
                            placeholder="폴더"
                            value={draft.folder}
                            onChange={(e) =>
                              setDraft({ ...draft, folder: e.target.value })
                            }
                          />
                        </div>
                        <input
                          aria-label="태그"
                          placeholder="태그 · 쉼표로 구분"
                          value={draft.tags}
                          onChange={(e) =>
                            setDraft({ ...draft, tags: e.target.value })
                          }
                        />
                        {draft.kind === "glossary" && (
                          <input
                            aria-label="별칭"
                            placeholder="별칭 · idempotency, 멱등"
                            value={draft.aliases}
                            onChange={(e) =>
                              setDraft({ ...draft, aliases: e.target.value })
                            }
                          />
                        )}
                        <textarea
                          className="editor"
                          aria-label="문서 내용"
                          placeholder="Markdown으로 기록하세요. [[문서 제목]]으로 연결할 수 있어요."
                          value={draft.content}
                          onChange={(e) =>
                            setDraft({ ...draft, content: e.target.value })
                          }
                        />
                      </>
                    ) : selected ? (
                      <>
                        <div className="reader-top">
                          <span className="eyebrow">
                            {typeName(selected.kind)} / REVISION{" "}
                            {selected.revision}
                          </span>
                          <div>
                            <button
                              title="개정 이력"
                              className="icon"
                              onClick={() => setHistory(!history)}
                            >
                              <History size={18} />
                            </button>
                            <button
                              title="편집"
                              className="icon"
                              onClick={() => {
                                setDraft({
                                  title: selected.title,
                                  content: selected.content,
                                  kind: selected.kind,
                                  folder: selected.folder,
                                  tags: selected.tags.join(", "),
                                  aliases: selected.aliases.join(", "),
                                });
                                setEditing(true);
                              }}
                            >
                              <Pencil size={18} />
                            </button>
                            <button
                              title="삭제"
                              className="icon"
                              onClick={() => {
                                if (
                                  confirm(
                                    "이 문서를 삭제할까요? 검색에서도 제외됩니다.",
                                  )
                                )
                                  act(async () => {
                                    await request(
                                      base + "/articles/" + selected.id,
                                      { method: "DELETE", body: "{}" },
                                    );
                                    setSelected(null);
                                    await load();
                                  });
                              }}
                            >
                              <Trash2 size={18} />
                            </button>
                          </div>
                        </div>
                        <h2>{selected.title}</h2>
                        <div className="reader-meta">
                          <span>{evidence(selected.evidence_status)}</span>
                          <span>{selected.folder || "미분류"}</span>
                          <span>{date(selected.updated_at)}</span>
                        </div>
                        {history && (
                          <div className="history">
                            {selected.revisions?.map((r) => (
                              <button
                                key={r.revision}
                                onClick={() =>
                                  act(async () => {
                                    const rev = await request<{
                                      title: string;
                                      content: string;
                                    }>(
                                      base +
                                        "/articles/" +
                                        selected.id +
                                        "/revisions/" +
                                        r.revision,
                                    );
                                    setSourcePreview({
                                      name: `r${r.revision} · ${rev.title}`,
                                      text: rev.content,
                                    });
                                  })
                                }
                              >
                                r{r.revision} · {r.title}{" "}
                                <span>{date(r.created_at)}</span>
                              </button>
                            ))}
                          </div>
                        )}
                        <article className="markdown">
                          <Markdown remarkPlugins={[remarkGfm]} skipHtml>
                            {selected.content}
                          </Markdown>
                        </article>
                        {selected.source_id && (
                          <button
                            className="source-link"
                            onClick={() =>
                              act(async () => {
                                const src = await request<{
                                  name: string;
                                  text: string;
                                }>(base + "/sources/" + selected.source_id);
                                setSourcePreview(src);
                              })
                            }
                          >
                            <Link size={16} /> 원천 자료 확인{" "}
                            <ArrowUpRight size={15} />
                          </button>
                        )}
                        {selected.links?.length ? (
                          <div className="relations">
                            <p className="eyebrow">CONNECTED KNOWLEDGE</p>
                            {selected.links.map((l) => (
                              <button
                                key={l.to_id}
                                onClick={() => openArticle(l.to_id)}
                              >
                                <Link size={15} />
                                {l.title}
                                <ChevronRight size={14} />
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <div className="empty reader-empty">
                        <BookOpen size={38} />
                        <h3>기록을 펼쳐 보세요</h3>
                        <p>
                          왼쪽에서 문서를 선택하면
                          <br />
                          내용과 연결된 근거를 확인할 수 있어요.
                        </p>
                        <button className="text-button" onClick={newArticle}>
                          새 문서 작성 <ArrowUpRight size={16} />
                        </button>
                      </div>
                    )}
                  </section>
                </div>
              </>
            )}
            {view === "sources" && (
              <>
                <section className="page-heading">
                  <div>
                    <p className="eyebrow">FROM RECORDS TO KNOWLEDGE</p>
                    <h1>원천 자료</h1>
                    <p>
                      메모와 작업 기록을 AI가 정리하고, 인용 근거를 연결해요.
                    </p>
                  </div>
                  <button
                    className="button primary"
                    onClick={() => {
                      setInput("");
                      setSourceText("");
                      setAllowed(false);
                      setModal("source");
                    }}
                  >
                    <Upload size={17} /> 자료 추가
                  </button>
                </section>
                <div className="info-banner">
                  AI 정리는 확인이 필요한 후보입니다. 개인·기밀 자료는 외부 전송
                  전에 확인해 주세요.
                </div>
                <div className="source-list">
                  {sources.length === 0 ? (
                    <div className="empty">
                      <Upload />
                      <h3>아직 원천 자료가 없어요</h3>
                      <p>비기밀 메모나 합성 자료로 첫 수집을 시작해 보세요.</p>
                    </div>
                  ) : (
                    sources.map((s) => (
                      <div className="source-row" key={s.id}>
                        <FileText size={20} />
                        <button
                          onClick={() =>
                            act(async () =>
                              setSourcePreview(
                                await request(base + "/sources/" + s.id),
                              ),
                            )
                          }
                        >
                          <b>{s.name}</b>
                          <small>
                            {s.model ??
                              (s.status === "failed"
                                ? "AI 처리 실패"
                                : "AI 처리 대기")}
                            {s.error_code ? " · " + s.error_code : ""}
                          </small>
                        </button>
                        <span className={"status " + s.status}>
                          {{
                            queued: "대기",
                            processing: "정리 중",
                            retrying: "재시도 대기",
                            completed: "완료",
                            failed: "실패",
                          }[s.status] ?? s.status}
                        </span>
                        {s.status === "failed" && (
                          <button
                            className="button"
                            disabled={busy}
                            onClick={() =>
                              act(async () => {
                                await request(
                                  base + "/sources/" + s.id + "/retry",
                                  { method: "POST", body: "{}" },
                                );
                                await loadSources();
                              })
                            }
                          >
                            재시도
                          </button>
                        )}
                        <button
                          className="icon"
                          title="원천 자료 삭제"
                          onClick={() => {
                            if (
                              confirm(
                                "원천 자료와 여기서 파생된 지식을 검색에서 제외할까요?",
                              )
                            )
                              act(async () => {
                                await request(base + "/sources/" + s.id, {
                                  method: "DELETE",
                                  body: "{}",
                                });
                                await loadSources();
                                await load();
                              });
                          }}
                        >
                          <Trash2 size={17} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
            {view === "keys" && (
              <>
                <section className="page-heading">
                  <div>
                    <p className="eyebrow">KNOWLEDGE FOR YOUR AGENT</p>
                    <h1>에이전트 연결</h1>
                    <p>
                      필요할 때 이 공간의 근거를 조회하세요. 별도 임베딩이나
                      로컬 DB는 필요 없어요.
                    </p>
                  </div>
                  <button
                    className="button primary"
                    onClick={() => {
                      setInput("");
                      setNewKey("");
                      setKeyScope("read");
                      setModal("key");
                    }}
                  >
                    <KeyRound size={17} /> 접근 키 만들기
                  </button>
                </section>
                <div className="connect-card">
                  <Terminal size={28} />
                  <h2>질문에 필요한 근거만 가져오기</h2>
                  <p>
                    조회 키는 선택한 Workspace에만 접근합니다. 키는 에이전트의
                    비밀 설정에 보관하세요.
                  </p>
                  <pre>{`curl --get '${location.origin}${base}/context' \\\n  --data-urlencode 'q=이전에 결정한 정책' \\\n  -H 'Authorization: Bearer YOUR_KEY'`}</pre>
                  <p className="small muted">
                    응답에는 발췌·문서 개정·출처·조회 시각이 포함됩니다. 답변은
                    현재 에이전트가 작성해요.
                  </p>
                </div>
                <div className="source-list">
                  {keys.map((k) => (
                    <div key={k.id} className="source-row">
                      <KeyRound size={18} />
                      <div>
                        <b>{k.name}</b>
                        <small>
                          {k.scope === "read"
                            ? "조회 전용"
                            : "조회 + 원천 자료 접수"}
                        </small>
                      </div>
                      <button
                        className="button"
                        onClick={() =>
                          act(async () => {
                            await request(base + "/keys/" + k.id, {
                              method: "DELETE",
                              body: "{}",
                            });
                            setKeys(keys.filter((x) => x.id !== k.id));
                          })
                        }
                      >
                        폐기
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </main>
      {(modal || sourcePreview) && (
        <div
          className="overlay"
          onClick={() => {
            if (!busy) {
              setModal(null);
              setSourcePreview(null);
              setNewKey("");
            }
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={sourcePreview?.name ?? "입력"}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="reader-top">
              <h2>
                {sourcePreview?.name ??
                  {
                    workspace: "새 Workspace",
                    source: "원천 자료 추가",
                    context: "에이전트에 전달할 근거",
                    key: "접근 키 만들기",
                  }[modal!] ??
                  ""}
              </h2>
              <button
                className="icon"
                disabled={busy}
                onClick={() => {
                  setModal(null);
                  setSourcePreview(null);
                  setNewKey("");
                }}
              >
                <X size={20} />
              </button>
            </div>
            {sourcePreview ? (
              <pre className="source-preview">{sourcePreview.text}</pre>
            ) : modal === "context" ? (
              <>
                <pre className="source-preview">{context}</pre>
                <button
                  className="button primary"
                  onClick={() => copy(context)}
                >
                  {copied ? <Check size={17} /> : <Copy size={17} />} Context
                  복사
                </button>
              </>
            ) : (
              <>
                {newKey ? (
                  <>
                    <p>이 키는 지금 한 번만 표시돼요.</p>
                    <pre className="key-value">{newKey}</pre>
                    <button
                      className="button primary"
                      onClick={() => copy(newKey)}
                    >
                      {copied ? "복사됨" : "키 복사"}
                    </button>
                  </>
                ) : (
                  <>
                    <label className="field">
                      {modal === "source"
                        ? "자료 이름"
                        : modal === "workspace"
                          ? "공간 이름"
                          : "키 이름"}
                      <input
                        autoFocus
                        placeholder={
                          modal === "workspace"
                            ? "업무 / 취미 / 학습"
                            : modal === "source"
                              ? "프로젝트 의사결정 메모"
                              : "나의 에이전트"
                        }
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                      />
                    </label>
                    {modal === "source" && (
                      <>
                        <label className="field">
                          텍스트 · Markdown
                          <input
                            type="file"
                            accept=".txt,.md,.json"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) {
                                if (f.size > 100000) {
                                  setError(
                                    "100KB 이하의 텍스트 파일을 선택하세요.",
                                  );
                                  return;
                                }
                                setInput(f.name);
                                f.text().then(setSourceText);
                              }
                            }}
                          />
                          <textarea
                            rows={10}
                            placeholder="자료를 붙여 넣거나 파일을 선택하세요"
                            value={sourceText}
                            onChange={(e) => setSourceText(e.target.value)}
                          />
                        </label>
                        <label className="consent">
                          <input
                            type="checkbox"
                            checked={allowed}
                            onChange={(e) => setAllowed(e.target.checked)}
                          />
                          이 자료를 NVIDIA 외부 AI에 보내 정리하는 데
                          동의합니다. 기밀·개인정보 포함 여부를 확인했어요.
                        </label>
                      </>
                    )}
                    {modal === "key" && (
                      <label className="field">
                        권한
                        <select
                          value={keyScope}
                          onChange={(e) => setKeyScope(e.target.value)}
                        >
                          <option value="read">조회 전용</option>
                          <option value="ingest">조회 + 자료 접수</option>
                        </select>
                      </label>
                    )}
                    <button
                      className="button primary"
                      disabled={
                        busy ||
                        !input.trim() ||
                        (modal === "source" && (!sourceText || !allowed))
                      }
                      onClick={() =>
                        act(async () => {
                          if (modal === "workspace") {
                            const r = await request<Workspace>(
                              "/api/workspaces",
                              {
                                method: "POST",
                                body: JSON.stringify({ name: input }),
                              },
                            );
                            await loadSpaces();
                            setWs(r.id);
                            setModal(null);
                          } else if (modal === "source") {
                            await request(base + "/sources", {
                              method: "POST",
                              headers: {
                                "Idempotency-Key": crypto.randomUUID(),
                              },
                              body: JSON.stringify({
                                name: input,
                                text: sourceText,
                                allowExternalAI: allowed,
                              }),
                            });
                            setModal(null);
                            setView("sources");
                            await loadSources();
                          } else if (modal === "key") {
                            const r = await request<{ token: string }>(
                              base + "/keys",
                              {
                                method: "POST",
                                body: JSON.stringify({
                                  name: input,
                                  scope: keyScope,
                                }),
                              },
                            );
                            setNewKey(r.token);
                            setKeys(
                              (
                                await request<{ items: typeof keys }>(
                                  base + "/keys",
                                )
                              ).items,
                            );
                          }
                        })
                      }
                    >
                      {busy
                        ? "처리 중…"
                        : modal === "source"
                          ? "정리 시작"
                          : "만들기"}
                      <ArrowUpRight size={16} />
                    </button>
                  </>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { supabase } from "../lib/supabase";

type Task = { id: string; title: string | null; due_date: string | null; priority: number; done: boolean };
type Note = { id: string; kind: "text" | "url" | "number"; body: string; created_at: string };
type Msg = { role: "user" | "assistant"; content: string };

const spring = { type: "spring", stiffness: 420, damping: 34 } as const;
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => iso(new Date());
const nice = (s: string) => (s === today() ? "Today" : new Date(s + "T00:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }));
const kindOf = (b: string): Note["kind"] => (/^https?:\/\/\S+$/i.test(b) ? "url" : b !== "" && isFinite(Number(b)) ? "number" : "text");
const TABS = ["Tasks", "Calendar", "Timeline", "Notes"];

export default function Page() {
  const [user, setUser] = useState<any>(undefined);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setUser(s?.user ?? null));
    return () => data.subscription.unsubscribe();
  }, []);
  if (user === undefined) return <div className="boot"><div className="spin" /></div>;
  return user ? <App user={user} /> : <Auth />;
}

function Auth() {
  const [up, setUp] = useState(false);
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const lock = useRef(false);
  async function go(e: React.FormEvent) {
    e.preventDefault();
    if (lock.current) return;
    lock.current = true; setBusy(true); setMsg("");
    const { data, error } = up
      ? await supabase.auth.signUp({ email, password: pw })
      : await supabase.auth.signInWithPassword({ email, password: pw });
    if (error) setMsg(error.message);
    else if (up && !data.session) setMsg("Check your inbox to confirm your email, then sign in.");
    lock.current = false; setBusy(false);
  }
  return (
    <div className="auth">
      <motion.form className="glass" onSubmit={go} initial={{ opacity: 0, y: 24, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={spring}>
        <div className="logo"><i />Flow</div>
        <h1>{up ? "Create your account" : "Welcome back"}</h1>
        <p>{up ? "Plan tasks, dates and notes in one calm place." : "Sign in to pick up where you left off."}</p>
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} required autoComplete="email" />
        <input type="password" placeholder="Password (6+ characters)" value={pw} onChange={(e) => setPw(e.target.value)} disabled={busy} required minLength={6} autoComplete={up ? "new-password" : "current-password"} />
        <AnimatePresence>{msg && <motion.div className="err" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>{msg}</motion.div>}</AnimatePresence>
        <button className="btn" disabled={busy}>{busy ? "One moment…" : up ? "Create account" : "Sign in"}</button>
        <button type="button" className="sw" onClick={() => { setUp(!up); setMsg(""); }}>{up ? "Have an account? Sign in" : "New here? Create an account"}</button>
      </motion.form>
    </div>
  );
}

function Row({ t, td, onPatch, onDel }: { t: Task; td: string; onPatch: (id: string, p: Partial<Task>) => void; onDel: (id: string) => void }) {
  const late = !t.done && !!t.due_date && t.due_date < td;
  const taRef = useRef<HTMLTextAreaElement>(null);
  const grow = (el: HTMLTextAreaElement | null) => { if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; } };
  useLayoutEffect(() => { grow(taRef.current); }, [t.title]);
  return (
    <motion.div layout initial={{ opacity: 0, y: 14, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, x: 70, scale: 0.95 }} transition={spring}
      className={"row glass" + (t.done ? " done" : "") + (late ? " late" : "")}>
      <div className="row-top">
        <button className={"chk" + (t.done ? " on" : "")} aria-label={t.done ? "Mark as open" : "Mark as done"} onClick={() => onPatch(t.id, { done: !t.done })}>
          <svg viewBox="0 0 24 24"><motion.path d="M6 12.5l4 4 8-9" initial={false} animate={{ pathLength: t.done ? 1 : 0 }} transition={{ duration: 0.25 }} /></svg>
        </button>
        <textarea ref={taRef} key={t.title ?? ""} className="ttl" defaultValue={t.title || ""} placeholder="Untitled" aria-label="Task title" rows={1}
          onInput={(e) => grow(e.currentTarget)}
          onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== t.title) onPatch(t.id, { title: v }); else { e.target.value = t.title || ""; grow(e.target); } }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } }} />
      </div>
      <div className="row-meta">
        <select className="pri" data-p={t.priority} value={t.priority} aria-label="Priority" onChange={(e) => onPatch(t.id, { priority: Number(e.target.value) })}>
          {["Low", "Normal", "High", "Urgent"].map((l, i) => <option key={l} value={i}>{l}</option>)}
        </select>
        <input type="date" className="dt" aria-label="Due date" value={t.due_date || ""} onChange={(e) => onPatch(t.id, { due_date: e.target.value || null })} />
        <button className="x" aria-label="Delete task" onClick={() => onDel(t.id)}>×</button>
      </div>
    </motion.div>
  );
}

function App({ user }: { user: any }) {
  const [tab, setTab] = useState("Tasks");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [note, setNote] = useState("");
  const [sel, setSel] = useState(today());
  const [cur, setCur] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [chat, setChat] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const lock = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const td = today();
  const flash = (m: string) => setToast(m);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 3200); return () => clearTimeout(t); }, [toast]);

  const load = async () => {
    const [t, n] = await Promise.all([
      supabase.from("tasks").select("id,title,due_date,priority,done").order("due_date", { nullsFirst: false }).order("created_at"),
      supabase.from("notes").select("*").order("created_at", { ascending: false }),
    ]);
    setTasks((t.data as Task[]) ?? []); setNotes((n.data as Note[]) ?? []);
  };
  useEffect(() => { load(); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);

  const patch = async (id: string, p: Partial<Task>) => {
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, ...p } : t)));
    const { data } = await supabase.from("tasks").update(p).eq("id", id).select("id");
    if (!data?.length) load(); // row vanished or update failed: resync instead of showing a false success
  };
  const del = async (id: string) => {
    setTasks((ts) => ts.filter((t) => t.id !== id));
    const { data, error } = await supabase.from("tasks").delete().eq("id", id).select("id");
    if (error || !data?.length) { flash("Couldn't delete that task. Restoring it."); load(); } // never claim success on 0 rows affected
  };
  const addTask = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = title.trim(); if (!v) return;
    setTitle("");
    const { error } = await supabase.from("tasks").insert({ title: v, due_date: due || null }).select("id");
    if (error) { flash("Couldn't add that task. Try again."); setTitle(v); } else { setDue(""); load(); }
  };
  const addNote = async (e: React.FormEvent) => {
    e.preventDefault();
    const b = note.trim(); if (!b) return;
    setNote("");
    const { error } = await supabase.from("notes").insert({ body: b, kind: kindOf(b) }).select("id");
    if (error) { flash("Couldn't save that note. Try again."); setNote(b); } else load();
  };

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = q.trim();
    if (!text || lock.current) return;
    lock.current = true; setBusy(true);
    const next: Msg[] = [...msgs, { role: "user", content: text }];
    setMsgs(next); setQ("");
    try {
      const { data } = await supabase.auth.getSession();
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token}` },
        // Truncate long history so token-per-minute limits stay healthy
        body: JSON.stringify({ today: td, messages: next.map((m) => ({ role: m.role, content: m.content.length > 600 ? m.content.slice(0, 600) + "…" : m.content })) }),
      });
      const j = await r.json();
      setMsgs([...next, { role: "assistant", content: j.reply || j.error || "Something went wrong." }]);
      await load();
    } catch {
      setMsgs([...next, { role: "assistant", content: "Couldn't reach the server. Check your connection and try again." }]);
    } finally { lock.current = false; setBusy(false); }
  }

  const byDate = useMemo(() => {
    const m: Record<string, Task[]> = {};
    tasks.forEach((t) => { if (t.due_date) (m[t.due_date] ??= []).push(t); });
    return m;
  }, [tasks]);

  const open = tasks.filter((t) => !t.done);
  const groups: [string, Task[], string][] = [
    ["Overdue", open.filter((t) => t.due_date && t.due_date < td), "red"],
    ["Today", open.filter((t) => t.due_date === td), ""],
    ["Upcoming", open.filter((t) => t.due_date && t.due_date > td), ""],
    ["Someday", open.filter((t) => !t.due_date), ""],
    ["Done", tasks.filter((t) => t.done), ""],
  ];
  const list = (arr: Task[]) => (
    <AnimatePresence initial={false}>{arr.map((t) => <Row key={t.id} t={t} td={td} onPatch={patch} onDel={del} />)}</AnimatePresence>
  );

  const first = new Date(cur.y, cur.m, 1).getDay();
  const dim = new Date(cur.y, cur.m + 1, 0).getDate(); // dynamic month length, leap-year safe
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: dim }, (_, i) => i + 1)];
  const step = (n: number) => { const d = new Date(cur.y, cur.m + n, 1); setCur({ y: d.getFullYear(), m: d.getMonth() }); };
  const dates = Object.keys(byDate).sort();

  return (
    <div className="wrap">
      <div className="top">
        <div className="logo"><i />Flow</div>
        <button className="av" title="Sign out" aria-label="Sign out" onClick={() => supabase.auth.signOut()}>{(user.email || "?")[0].toUpperCase()}</button>
      </div>
      <nav className="seg glass">
        {TABS.map((t) => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
            {tab === t && <motion.div layoutId="pill" className="pill" transition={spring} />}
            <span>{t}</span>
          </button>
        ))}
      </nav>

      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
          {tab === "Tasks" && (
            <>
              <form className="quick glass" onSubmit={addTask}>
                <input type="text" placeholder="Add a task" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="New task" />
                <input type="date" className="dt" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" />
                <button className="btn" disabled={!title.trim()}>Add</button>
              </form>
              {tasks.length === 0 && <div className="empty">Nothing here yet.<br />Add your first task above, or ask the assistant.</div>}
              {groups.map(([name, arr, c]) => arr.length > 0 && (
                <section key={name}><h3 className={"sec " + c}>{name} · {arr.length}</h3>{list(arr)}</section>
              ))}
            </>
          )}

          {tab === "Calendar" && (
            <>
              <div className="cal-h">
                <button className="nav" aria-label="Previous month" onClick={() => step(-1)}>‹</button>
                <b>{new Date(cur.y, cur.m, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" })}</b>
                <button className="nav" aria-label="Next month" onClick={() => step(1)}>›</button>
              </div>
              <AnimatePresence mode="wait">
                <motion.div key={`${cur.y}-${cur.m}`} className="grid glass" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.18 }}>
                  {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div key={i} className="wd">{d}</div>)}
                  {cells.map((d, i) => {
                    if (!d) return <div key={i} />;
                    const k = iso(new Date(cur.y, cur.m, d));
                    const n = (byDate[k] || []).filter((t) => !t.done).length;
                    return (
                      <button key={i} className={"day" + (k === td ? " tdy" : "") + (k === sel ? " sel" : "")} onClick={() => setSel(k)}>
                        {d}<span className="dots">{Array.from({ length: Math.min(n, 3) }, (_, j) => <i key={j} />)}</span>
                      </button>
                    );
                  })}
                </motion.div>
              </AnimatePresence>
              <h3 className="sec">{nice(sel)}</h3>
              {(byDate[sel] || []).length ? list(byDate[sel]) : <div className="empty" style={{ padding: 30 }}>Free day. Pick a date in the add bar on Tasks to plan something.</div>}
            </>
          )}

          {tab === "Timeline" && (
            dates.length ? (
              <div className="tl">
                {dates.map((d) => (
                  <motion.div key={d} className={"g" + (d === td ? " now" : "") + (d < td && byDate[d].some((t) => !t.done) ? " late" : "")}
                    initial={{ opacity: 0, x: -12 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true, margin: "-40px" }} transition={spring}>
                    <b>{nice(d)}</b>{list(byDate[d])}
                  </motion.div>
                ))}
              </div>
            ) : <div className="empty">Your timeline fills in as you give tasks a due date.</div>
          )}

          {tab === "Notes" && (
            <>
              <form className="notes-in glass" onSubmit={addNote}>
                <input type="text" placeholder="Save a note, link or number" value={note} onChange={(e) => setNote(e.target.value)} aria-label="New note" />
                <button className="btn" disabled={!note.trim()}>Save</button>
              </form>
              {notes.length === 0 && <div className="empty">Notes, links and numbers you save will live here.</div>}
              <AnimatePresence initial={false}>
                {notes.map((n) => (
                  <motion.div key={n.id} layout className="note glass" initial={{ opacity: 0, y: 14, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, x: 70 }} transition={spring}>
                    <div className="b">
                      {n.kind === "url" ? <a href={n.body} target="_blank" rel="noopener noreferrer">{n.body.replace(/^https?:\/\//, "")}</a>
                        : n.kind === "number" ? <span className="num">{n.body}</span> : n.body}
                      <small>{new Date(n.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</small>
                    </div>
                    <button className="x" aria-label="Delete note" onClick={async () => { setNotes((ns) => ns.filter((x) => x.id !== n.id)); await supabase.from("notes").delete().eq("id", n.id); }}>×</button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </>
          )}
        </motion.div>
      </AnimatePresence>

      <AnimatePresence>
        {toast && (
          <motion.div className="toast glass" role="status" initial={{ opacity: 0, y: 12, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.96 }} transition={spring}>
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {!chat && <motion.button className="fab" aria-label="Open assistant" onClick={() => setChat(true)} initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }} transition={spring}>✦</motion.button>}
        {chat && (
          <motion.div className="sheet glass" initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={spring}>
            <header><span>Assistant</span><button className="nav" aria-label="Close assistant" onClick={() => setChat(false)}>×</button></header>
            <div className="msgs">
              {msgs.length === 0 && <div className="empty" style={{ padding: 24 }}>Try “add dentist next Tuesday, high priority” or “what’s overdue?”</div>}
              {msgs.map((m, i) => <motion.div key={i} className={"msg " + m.role} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={spring}>{m.content}</motion.div>)}
              {busy && <div className="typing"><i /><i /><i /></div>}
              <div ref={endRef} />
            </div>
            <form className="chat-in" onSubmit={send}>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={busy ? "Working on it…" : "Ask or tell me anything"} disabled={busy} aria-label="Message" />
              <button className="btn" disabled={busy || !q.trim()}>Send</button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

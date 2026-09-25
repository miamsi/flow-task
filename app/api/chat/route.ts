import { createClient } from "@supabase/supabase-js";
export const maxDuration = 30;

const fn = (name: string, description: string, properties: any, required: string[] = []) => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties, required } },
});
const S = { type: "string" }, B = { type: "boolean" };
const D = { type: "string", description: "YYYY-MM-DD" };
const TOOLS = [
  fn("list_tasks", "List tasks. Use the boolean filters for state. Counts are computed by the backend.", {
    done: B, overdue: { ...B, description: "true = open tasks past their due date" }, from: D, to: D,
  }),
  fn("add_task", "Create a task", {
    title: S, due_date: D, description: S,
    priority: { type: "integer", description: "0 low, 1 normal, 2 high, 3 urgent" },
  }, ["title"]),
  fn("update_task", "Update a task by id", { id: S, title: S, due_date: D, priority: { type: "integer" }, done: B }, ["id"]),
  fn("delete_task", "Delete a task by id", { id: S }, ["id"]),
  fn("add_note", "Save a note (text, URL or number)", { body: S }, ["body"]),
];

const okDate = (d: any) => {
  try { return typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(d + "T00:00:00Z").toISOString().slice(0, 10) === d; }
  catch { return false; }
};
const okPri = (p: any) => Number.isInteger(p) && p >= 0 && p <= 3; // 0 is valid

async function run(sb: any, name: string, a: any, today: string): Promise<string> {
  try {
    if (name === "list_tasks") {
      let q = sb.from("tasks").select("id,title,due_date,priority,done")
        .order("due_date", { ascending: true, nullsFirst: false }).limit(50);
      if (typeof a.done === "boolean") q = q.eq("done", a.done);
      if (a.overdue === true) q = q.eq("done", false).lt("due_date", today);
      if (okDate(a.from)) q = q.gte("due_date", a.from);
      if (okDate(a.to)) q = q.lte("due_date", a.to);
      const { data, error } = await q;
      if (error) return "Error: " + error.message;
      const tasks = (data ?? []).map((r: any) => ({ ...r, title: r.title || "Untitled", due_date: r.due_date || "none" }));
      return JSON.stringify({ total: tasks.length, open: tasks.filter((r: any) => !r.done).length, tasks });
    }
    if (name === "add_task") {
      const title = String(a.title ?? "").trim();
      if (!title) return "Error: title is required";
      if (a.due_date != null && !okDate(a.due_date)) return "Error: due_date must be a real date as YYYY-MM-DD";
      if (a.priority != null && !okPri(a.priority)) return "Error: priority must be an integer 0-3";
      const { data, error } = await sb.from("tasks")
        .insert({ title, due_date: a.due_date ?? null, priority: a.priority ?? 1, description: a.description ?? null }).select("id");
      return error || !data?.length ? "Error: insert failed" : `OK: created task ${data[0].id}`;
    }
    if (name === "update_task" || name === "delete_task") {
      if (!a.id) return "Error: id is required";
      let q;
      if (name === "delete_task") q = sb.from("tasks").delete().eq("id", a.id).select("id");
      else {
        const p: any = {};
        if (typeof a.title === "string" && a.title.trim()) p.title = a.title.trim();
        if (a.due_date === null || okDate(a.due_date)) { if (a.due_date !== undefined) p.due_date = a.due_date; }
        else if (a.due_date !== undefined) return "Error: due_date must be a real date as YYYY-MM-DD";
        if (a.priority !== undefined) { if (!okPri(a.priority)) return "Error: priority must be an integer 0-3"; p.priority = a.priority; }
        if (typeof a.done === "boolean") p.done = a.done;
        if (!Object.keys(p).length) return "Error: nothing valid to update";
        q = sb.from("tasks").update(p).eq("id", a.id).select("id");
      }
      const { data, error } = await q;
      if (error) return "Error: " + error.message;
      if (!data?.length) return "Error: ID not found. Call list_tasks to get valid IDs.";
      return `OK: ${name} ${a.id}`;
    }
    if (name === "add_note") {
      const body = String(a.body ?? "").trim();
      if (!body) return "Error: body is required";
      const kind = /^https?:\/\/\S+$/i.test(body) ? "url" : isFinite(Number(body)) ? "number" : "text";
      const { data, error } = await sb.from("notes").insert({ body, kind }).select("id");
      return error || !data?.length ? "Error: insert failed" : "OK: note saved";
    }
    return "Error: unknown tool";
  } catch (e: any) {
    return "Error: " + (e?.message || "tool failed");
  }
}

export async function POST(req: Request) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return Response.json({ error: "Please sign in again." }, { status: 401 });
  let body: any;
  try { body = await req.json(); } catch { return Response.json({ error: "Bad request" }, { status: 400 }); }
  const { messages, today } = body ?? {};
  if (!okDate(today)) return Response.json({ error: "Bad date" }, { status: 400 });

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  // Deterministic calendar for relative dates: computed here, never by the LLM
  const cal = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(today + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + i);
    return `${d.toISOString().slice(0, 10)} ${d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })}`;
  }).join(", ");

  const msgs: any[] = [
    { role: "system", content:
      `You are Flow, a concise task assistant. Today is ${today}. Next 14 days: ${cal}. Use this table for relative dates. ` +
      `Use tools for all data and never invent ids (call list_tasks first when you need one). Only say something succeeded if a tool returned "OK". ` +
      `If a tool returns Error, correct it or tell the user plainly. Reply in under 80 words.` },
    ...(Array.isArray(messages) ? messages.slice(-8) : []),
  ];

  for (let round = 0; round < 3; round++) {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({
        model: "qwen/qwen3.8-27b", temperature: 0.2, messages: msgs,
        ...(round < 2 ? { tools: TOOLS, tool_choice: "auto" } : {}), // final round: no tools, must answer
      }),
    });
    if (!r.ok) {
      const limited = r.status === 429;
      return Response.json({ error: limited ? "Rate limited. Try again in a few seconds." : "The assistant is unavailable right now." }, { status: limited ? 429 : 502 });
    }
    const m = (await r.json()).choices?.[0]?.message;
    if (!m?.tool_calls?.length) return Response.json({ reply: m?.content || "I couldn't complete that. Please try again." });
    msgs.push(m);
    for (const c of m.tool_calls) {
      let args = {}; try { args = JSON.parse(c.function.arguments || "{}"); } catch {}
      msgs.push({ role: "tool", tool_call_id: c.id, content: await run(sb, c.function.name, args, today) });
    }
  }
  return Response.json({ reply: "That took too many steps. Try a simpler request." });
}

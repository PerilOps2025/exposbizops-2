import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { digestType, userId } = await req.json();
    // digestType: "daily" | "weekly" | "breakfast"

    if (!userId) {
      return new Response(JSON.stringify({ error: "userId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check config for digest settings
    const { data: configData } = await supabase
      .from("config")
      .select("key, value")
      .eq("user_id", userId)
      .in("key", ["DIGEST_EMAIL", "DIGEST_DAILY_PAUSED", "DIGEST_WEEKLY_PAUSED", "DIGEST_BREAKFAST_PAUSED"]);

    const config: Record<string, any> = {};
    configData?.forEach((c: any) => { config[c.key] = c.value; });

    const digestEmail = config.DIGEST_EMAIL;
    if (!digestEmail) {
      return new Response(JSON.stringify({ error: "No digest email configured" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if paused
    if (digestType === "daily" && config.DIGEST_DAILY_PAUSED === true) {
      return new Response(JSON.stringify({ skipped: true, reason: "Daily digest paused" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (digestType === "weekly" && config.DIGEST_WEEKLY_PAUSED === true) {
      return new Response(JSON.stringify({ skipped: true, reason: "Weekly digest paused" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (digestType === "breakfast" && config.DIGEST_BREAKFAST_PAUSED === true) {
      return new Response(JSON.stringify({ skipped: true, reason: "Breakfast digest paused" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    const tomorrowEnd = new Date(tomorrowStart);
    tomorrowEnd.setHours(23, 59, 59, 999);

    let htmlContent = "";
    let subject = "";

    if (digestType === "breakfast") {
      // Morning look at the day ahead
      subject = `☀️ ExPOS Breakfast Brief — ${now.toLocaleDateString("en-IN", { weekday: "long", month: "short", day: "numeric" })}`;

      const { data: todayTasks } = await supabase
        .from("active_tasks")
        .select("*")
        .eq("user_id", userId)
        .lte("due_date", todayEnd.toISOString().split("T")[0])
        .in("status", ["Active", "WaitingOn", "Blocked"]);

      const { data: overdueTasks } = await supabase
        .from("active_tasks")
        .select("*")
        .eq("user_id", userId)
        .lt("due_date", todayStart.toISOString().split("T")[0])
        .in("status", ["Active", "WaitingOn", "Blocked"]);

      htmlContent = buildBreakfastHtml(todayTasks || [], overdueTasks || [], now);

    } else if (digestType === "daily") {
      // Evening summary: what happened today + what's tomorrow
      subject = `🌙 ExPOS Daily Digest — ${now.toLocaleDateString("en-IN", { weekday: "long", month: "short", day: "numeric" })}`;

      const { data: completedToday } = await supabase
        .from("archive")
        .select("*")
        .eq("user_id", userId)
        .gte("archived_at", todayStart.toISOString())
        .lte("archived_at", todayEnd.toISOString());

      const { data: decisionsToday } = await supabase
        .from("decisions")
        .select("*")
        .eq("user_id", userId)
        .gte("created_at", todayStart.toISOString())
        .lte("created_at", todayEnd.toISOString());

      const { data: tomorrowTasks } = await supabase
        .from("active_tasks")
        .select("*")
        .eq("user_id", userId)
        .gte("due_date", tomorrowStart.toISOString().split("T")[0])
        .lte("due_date", tomorrowEnd.toISOString().split("T")[0])
        .in("status", ["Active", "WaitingOn", "Blocked"]);

      const { data: overdueTasks } = await supabase
        .from("active_tasks")
        .select("*")
        .eq("user_id", userId)
        .lt("due_date", todayStart.toISOString().split("T")[0])
        .in("status", ["Active", "WaitingOn", "Blocked"]);

      htmlContent = buildDailyHtml(completedToday || [], decisionsToday || [], tomorrowTasks || [], overdueTasks || [], now);

    } else if (digestType === "weekly") {
      // Weekly summary
      const weekStart = new Date(todayStart);
      weekStart.setDate(weekStart.getDate() - 6);
      const nextWeekEnd = new Date(todayEnd);
      nextWeekEnd.setDate(nextWeekEnd.getDate() + 7);

      subject = `📊 ExPOS Weekly Digest — Week of ${weekStart.toLocaleDateString("en-IN", { month: "short", day: "numeric" })}`;

      const { data: completedThisWeek } = await supabase
        .from("archive")
        .select("*")
        .eq("user_id", userId)
        .gte("archived_at", weekStart.toISOString());

      const { data: decisionsThisWeek } = await supabase
        .from("decisions")
        .select("*")
        .eq("user_id", userId)
        .gte("created_at", weekStart.toISOString());

      const { data: nextWeekTasks } = await supabase
        .from("active_tasks")
        .select("*")
        .eq("user_id", userId)
        .gte("due_date", tomorrowStart.toISOString().split("T")[0])
        .lte("due_date", nextWeekEnd.toISOString().split("T")[0])
        .in("status", ["Active", "WaitingOn", "Blocked"]);

      const { data: overdueTasks } = await supabase
        .from("active_tasks")
        .select("*")
        .eq("user_id", userId)
        .lt("due_date", todayStart.toISOString().split("T")[0])
        .in("status", ["Active", "WaitingOn", "Blocked"]);

      htmlContent = buildWeeklyHtml(completedThisWeek || [], decisionsThisWeek || [], nextWeekTasks || [], overdueTasks || [], weekStart, now);
    }

    return new Response(JSON.stringify({
      success: true,
      digestType,
      email: digestEmail,
      subject,
      html: htmlContent,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-digest error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function priorityIcon(p: string | null) {
  return p === "High" ? "🔴" : p === "Low" ? "🟢" : "🟡";
}

function taskRow(t: any) {
  return `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee;">${priorityIcon(t.priority)}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;">${t.task || t.task_id}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;color:#888;">${(t.person || []).join(", ") || "—"}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;color:#888;">${t.due_date || "—"}</td></tr>`;
}

function wrapHtml(title: string, body: string) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:0;background:#f5f5f5;color:#1a1a1a}table{width:100%;border-collapse:collapse}.container{max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden}.header{background:#3B82F6;color:#fff;padding:24px;text-align:center}.section{padding:20px 24px}.section-title{font-size:16px;font-weight:700;margin:0 0 12px;padding-bottom:8px;border-bottom:2px solid #3B82F6}.footer{padding:16px 24px;text-align:center;color:#999;font-size:12px;border-top:1px solid #eee}</style></head><body><div class="container"><div class="header"><h1 style="margin:0;font-size:20px;">${title}</h1></div>${body}<div class="footer">ExPOS — Executive Personal OS</div></div></body></html>`;
}

function buildBreakfastHtml(todayTasks: any[], overdueTasks: any[], now: Date) {
  const dateStr = now.toLocaleDateString("en-IN", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  let body = `<div class="section"><p style="color:#666;margin:0 0 16px;">Good morning! Here's your day at a glance — ${dateStr}</p></div>`;

  if (overdueTasks.length > 0) {
    body += `<div class="section"><h2 class="section-title" style="color:#ef4444;">⚠️ Overdue (${overdueTasks.length})</h2><table>${overdueTasks.map(taskRow).join("")}</table></div>`;
  }

  body += `<div class="section"><h2 class="section-title">📋 Today's Agenda (${todayTasks.length})</h2>`;
  if (todayTasks.length > 0) {
    body += `<table>${todayTasks.map(taskRow).join("")}</table>`;
  } else {
    body += `<p style="color:#888;">No tasks due today. Clear schedule! 🎉</p>`;
  }
  body += `</div>`;

  return wrapHtml("☀️ Breakfast Brief", body);
}

function buildDailyHtml(completed: any[], decisions: any[], tomorrowTasks: any[], overdue: any[], now: Date) {
  let body = "";

  // Karma section (what happened today)
  body += `<div class="section"><h2 class="section-title">🔥 Karma</h2>`;
  if (completed.length > 0) {
    body += `<p style="color:#666;margin:0 0 8px;"><strong>${completed.length}</strong> tasks completed today</p><table>${completed.map(t => `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee;">✅</td><td style="padding:6px 8px;border-bottom:1px solid #eee;">${t.task || t.task_id}</td></tr>`).join("")}</table>`;
  } else {
    body += `<p style="color:#888;">No tasks completed today.</p>`;
  }
  if (decisions.length > 0) {
    body += `<p style="margin:12px 0 8px;"><strong>${decisions.length}</strong> decisions made:</p><ul style="margin:0;padding-left:20px;">${decisions.map(d => `<li style="margin:4px 0;">${d.decision_text}</li>`).join("")}</ul>`;
  }
  body += `</div>`;

  // Consequences section (what's coming tomorrow)
  body += `<div class="section"><h2 class="section-title">⚡ Consequences</h2>`;
  if (tomorrowTasks.length > 0) {
    body += `<p style="color:#666;margin:0 0 8px;"><strong>${tomorrowTasks.length}</strong> tasks due tomorrow</p><table>${tomorrowTasks.map(taskRow).join("")}</table>`;
  } else {
    body += `<p style="color:#888;">Nothing due tomorrow. 🌟</p>`;
  }
  if (overdue.length > 0) {
    body += `<p style="margin:12px 0 8px;color:#ef4444;"><strong>⚠️ ${overdue.length} overdue tasks</strong> still pending</p><table>${overdue.map(taskRow).join("")}</table>`;
  }
  body += `</div>`;

  return wrapHtml("🌙 Daily Digest", body);
}

function buildWeeklyHtml(completed: any[], decisions: any[], nextWeekTasks: any[], overdue: any[], weekStart: Date, now: Date) {
  const weekRange = `${weekStart.toLocaleDateString("en-IN", { month: "short", day: "numeric" })} — ${now.toLocaleDateString("en-IN", { month: "short", day: "numeric" })}`;
  let body = `<div class="section"><p style="color:#666;margin:0;">Week in review: ${weekRange}</p></div>`;

  // Karma
  body += `<div class="section"><h2 class="section-title">🔥 Karma — This Week</h2>`;
  body += `<p><strong>${completed.length}</strong> tasks completed · <strong>${decisions.length}</strong> decisions made</p>`;
  if (completed.length > 0) {
    body += `<table>${completed.slice(0, 20).map(t => `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee;">✅</td><td style="padding:4px 8px;border-bottom:1px solid #eee;">${t.task || t.task_id}</td></tr>`).join("")}</table>`;
  }
  if (decisions.length > 0) {
    body += `<ul style="margin:8px 0;padding-left:20px;">${decisions.slice(0, 10).map(d => `<li style="margin:4px 0;">${d.decision_text}</li>`).join("")}</ul>`;
  }
  body += `</div>`;

  // Consequences
  body += `<div class="section"><h2 class="section-title">⚡ Consequences — Next Week</h2>`;
  if (nextWeekTasks.length > 0) {
    body += `<p><strong>${nextWeekTasks.length}</strong> tasks due next week</p><table>${nextWeekTasks.map(taskRow).join("")}</table>`;
  } else {
    body += `<p style="color:#888;">No tasks due next week. 🌟</p>`;
  }
  if (overdue.length > 0) {
    body += `<p style="margin:12px 0 8px;color:#ef4444;"><strong>⚠️ ${overdue.length} overdue tasks</strong></p><table>${overdue.map(taskRow).join("")}</table>`;
  }
  body += `</div>`;

  return wrapHtml("📊 Weekly Digest", body);
}

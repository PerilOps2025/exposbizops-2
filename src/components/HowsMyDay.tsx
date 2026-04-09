import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle, AlertCircle, Clock, Video, Users, CalendarDays, ListTodo, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { format, isToday, parseISO } from "date-fns";
import { getPriorityEmoji, isOverdue } from "@/lib/supabase-helpers";
import TaskCompletionModal from "@/components/TaskCompletionModal";

interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  attendees: { email: string; name: string; responseStatus: string }[];
  meetLink: string | null;
  htmlLink: string;
}

export default function HowsMyDay({ onNavigate }: { onNavigate?: (tab: string) => void }) {
  const [todayTasks, setTodayTasks] = useState<any[]>([]);
  const [overdueTasks, setOverdueTasks] = useState<any[]>([]);
  const [todayMeetings, setTodayMeetings] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [completingTask, setCompletingTask] = useState<any>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const today = new Date().toISOString().split("T")[0];

      const [tasksRes, overdueRes, meetingsRes] = await Promise.all([
        supabase
          .from("active_tasks")
          .select("*")
          .lte("due_date", today)
          .gte("due_date", today)
          .in("status", ["Active", "WaitingOn", "Blocked"]),
        supabase
          .from("active_tasks")
          .select("*")
          .lt("due_date", today)
          .in("status", ["Active", "WaitingOn", "Blocked"]),
        supabase.functions.invoke("google-calendar-events", {
          headers: { Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}` },
        }),
      ]);

      setTodayTasks(tasksRes.data || []);
      setOverdueTasks(overdueRes.data || []);

      if (meetingsRes.data?.events) {
        const todayEvents = meetingsRes.data.events.filter((e: CalendarEvent) => isToday(parseISO(e.start)));
        setTodayMeetings(todayEvents);
      }
    } catch (err) {
      console.error("Failed to load day data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  if (loading) {
    return <div className="flex items-center justify-center min-h-[50vh] text-muted-foreground">Loading your day...</div>;
  }

  const allTodayItems = todayTasks.filter(t => t.status !== "Done");
  const followUps = allTodayItems.filter(t => t.parent_task_id);
  const regularTasks = allTodayItems.filter(t => !t.parent_task_id);

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-bold">How's My Day</h2>
        <p className="text-sm text-muted-foreground">{format(new Date(), "EEEE, MMMM d, yyyy")}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Today Quadrant */}
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-primary" /> Today
            </h3>
            <Badge variant="secondary" className="text-xs">{regularTasks.length + followUps.length} items</Badge>
          </div>

          {regularTasks.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-1.5 font-medium uppercase tracking-wide">Tasks</p>
              <div className="space-y-1.5">
                {regularTasks.map(t => (
                  <div key={t.id} className="flex items-center gap-2 text-sm p-2 bg-muted/50 rounded-lg group">
                    <span>{getPriorityEmoji(t.priority)}</span>
                    <span className="flex-1 min-w-0 truncate">{t.task}</span>
                    {t.person?.length > 0 && (
                      <span className="text-xs text-muted-foreground hidden sm:inline">{t.person.join(", ")}</span>
                    )}
                    <Button
                      variant="ghost" size="sm"
                      className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100"
                      onClick={() => setCompletingTask(t)}
                    >
                      <CheckCircle className="w-3.5 h-3.5 text-success" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {followUps.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-1.5 font-medium uppercase tracking-wide">Follow-ups</p>
              <div className="space-y-1.5">
                {followUps.map(t => (
                  <div key={t.id} className="flex items-center gap-2 text-sm p-2 bg-primary/5 rounded-lg border border-primary/10 group">
                    <span>{getPriorityEmoji(t.priority)}</span>
                    <span className="flex-1 min-w-0 truncate">{t.task}</span>
                    <Badge variant="outline" className="text-[10px] h-5">Follow-up</Badge>
                    <Button
                      variant="ghost" size="sm"
                      className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100"
                      onClick={() => setCompletingTask(t)}
                    >
                      <CheckCircle className="w-3.5 h-3.5 text-success" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {regularTasks.length === 0 && followUps.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No tasks due today 🎉</p>
          )}
        </Card>

        {/* Overdue Quadrant */}
        <Card className={`p-4 space-y-3 ${overdueTasks.length > 0 ? 'border-destructive/30' : ''}`}>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <AlertCircle className={`w-4 h-4 ${overdueTasks.length > 0 ? 'text-destructive' : 'text-muted-foreground'}`} /> Overdue
            </h3>
            {overdueTasks.length > 0 && (
              <Badge variant="destructive" className="text-xs">{overdueTasks.length}</Badge>
            )}
          </div>

          {overdueTasks.length > 0 ? (
            <div className="space-y-1.5">
              {overdueTasks.map(t => (
                <div key={t.id} className="flex items-center gap-2 text-sm p-2 bg-destructive/5 rounded-lg group">
                  <span>{getPriorityEmoji(t.priority)}</span>
                  <span className="flex-1 min-w-0 truncate">{t.task}</span>
                  <span className="text-xs text-destructive font-medium">
                    {t.due_date ? format(new Date(t.due_date), "MMM d") : ""}
                  </span>
                  <Button
                    variant="ghost" size="sm"
                    className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100"
                    onClick={() => setCompletingTask(t)}
                  >
                    <CheckCircle className="w-3.5 h-3.5 text-success" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">Nothing overdue! 🌟</p>
          )}
        </Card>

        {/* Today's Meetings - Full Width */}
        <Card className="p-4 space-y-3 md:col-span-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" /> Today's Meetings
            </h3>
            <Button
              variant="ghost" size="sm" className="gap-1 h-7 text-xs"
              onClick={() => onNavigate?.("meeting")}
            >
              View all <ArrowRight className="w-3 h-3" />
            </Button>
          </div>

          {todayMeetings.length > 0 ? (
            <div className="space-y-2">
              {todayMeetings.map(event => (
                <div key={event.id} className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{event.title}</p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {format(parseISO(event.start), "h:mm a")} — {format(parseISO(event.end), "h:mm a")}
                      </span>
                      {event.attendees.length > 0 && (
                        <span className="flex items-center gap-1">
                          <Users className="w-3 h-3" /> {event.attendees.length}
                        </span>
                      )}
                    </div>
                    {event.attendees.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {event.attendees.slice(0, 5).map((a, i) => (
                          <Badge key={i} variant="outline" className="text-[10px] h-5">
                            {a.name || a.email}
                          </Badge>
                        ))}
                        {event.attendees.length > 5 && (
                          <Badge variant="outline" className="text-[10px] h-5">+{event.attendees.length - 5}</Badge>
                        )}
                      </div>
                    )}
                  </div>
                  {event.meetLink && (
                    <a
                      href={event.meetLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-shrink-0"
                    >
                      <Button variant="default" size="sm" className="gap-1 h-8">
                        <Video className="w-3.5 h-3.5" /> Join
                      </Button>
                    </a>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">No meetings today 📭</p>
          )}
        </Card>
      </div>

      <TaskCompletionModal
        open={!!completingTask}
        onClose={() => setCompletingTask(null)}
        task={completingTask}
        onCompleted={loadData}
      />
    </div>
  );
}

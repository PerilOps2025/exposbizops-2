import { useState, useEffect, useRef } from "react";
import { X, Calendar, CheckCircle, ListTodo, ArrowRight, Video, Link2, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { generateId, getPriorityEmoji } from "@/lib/supabase-helpers";
import { format, parseISO, isToday, isTomorrow } from "date-fns";

type ItemType = "Task" | "Decision" | "Event" | "FollowUp";

interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  attendees: { email: string; name: string }[];
}

interface NewItemModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  defaultType?: ItemType;
  parentTask?: any;
}

export default function NewItemModal({ open, onClose, onCreated, defaultType = "Task", parentTask }: NewItemModalProps) {
  const [type, setType] = useState<ItemType>(defaultType);
  const [text, setText] = useState("");
  const [person, setPerson] = useState("");
  const [team, setTeam] = useState(parentTask?.team || "");
  const [projectTag, setProjectTag] = useState(parentTask?.project_tag || "");
  const [priority, setPriority] = useState("Med");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [isMeetingContext, setIsMeetingContext] = useState(false);
  // Event-specific
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");
  const [attendeeEmails, setAttendeeEmails] = useState("");
  const [eventTitle, setEventTitle] = useState("");
  const [addMeetLink, setAddMeetLink] = useState(true);
  const [isAllDay, setIsAllDay] = useState(false);
  // Decision-specific
  const [context, setContext] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [saving, setSaving] = useState(false);

  // Meeting linking state
  const [linkedMeetingId, setLinkedMeetingId] = useState("");
  const [linkedMeetingTitle, setLinkedMeetingTitle] = useState("");
  const [suggestedMeetings, setSuggestedMeetings] = useState<CalendarEvent[]>([]);
  const [allMeetings, setAllMeetings] = useState<CalendarEvent[]>([]);
  const [meetingsLoading, setMeetingsLoading] = useState(false);
  const [showAllMeetings, setShowAllMeetings] = useState(false);
  const [peopleRegistry, setPeopleRegistry] = useState<{ name: string; email: string }[]>([]);
  const matchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load calendar events + people registry when modal opens
  useEffect(() => {
    if (!open) return;
    loadCalendarEvents();
    loadPeopleRegistry();
  }, [open]);

  // Re-run smart matching whenever person or projectTag changes (debounced)
  useEffect(() => {
    if (matchTimerRef.current) clearTimeout(matchTimerRef.current);
    matchTimerRef.current = setTimeout(() => {
      computeSuggestions(allMeetings, peopleRegistry, person, projectTag);
    }, 300);
  }, [person, projectTag, allMeetings, peopleRegistry]);

  const loadPeopleRegistry = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from("config")
      .select("value")
      .eq("user_id", user.id)
      .eq("key", "ENTITY_PEOPLE")
      .single();
    if (data?.value) setPeopleRegistry(data.value as { name: string; email: string }[]);
  };

  const loadCalendarEvents = async () => {
    setMeetingsLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-calendar-events`;
      const fetchRes = await fetch(fnUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ days: 30 }),
      });
      if (!fetchRes.ok) return;
      const resData = await fetchRes.json();
      if (!resData?.events) return;
      const events: CalendarEvent[] = resData.events;
      setAllMeetings(events);
      computeSuggestions(events, peopleRegistry, person, projectTag);
    } catch (e) {
      console.error("Failed to load calendar events:", e);
    } finally {
      setMeetingsLoading(false);
    }
  };

  // Core matching logic
  // - person field → look up in registry → get email → match against attendees
  // - projectTag → keyword match against event title
  const computeSuggestions = (
    events: CalendarEvent[],
    registry: { name: string; email: string }[],
    personField: string,
    projectField: string
  ) => {
    if (events.length === 0) return;

    // Resolve person names to emails via registry
    const personNames = personField.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    const resolvedEmails = new Set<string>();
    for (const pName of personNames) {
      for (const reg of registry) {
        if (
          reg.name.toLowerCase().includes(pName) ||
          pName.includes(reg.name.toLowerCase()) ||
          reg.email.toLowerCase().includes(pName)
        ) {
          resolvedEmails.add(reg.email.toLowerCase());
        }
      }
      // Also treat it as a direct email if it contains @
      if (pName.includes("@")) resolvedEmails.add(pName);
    }

    // Project keywords
    const stopWords = new Set(["with","this","that","from","have","will","been","your","their","about","meeting","call","sync","chat","review","discussion","weekly","daily"]);
    const projectKeywords = projectField
      .toLowerCase()
      .split(/[\s\-_/]+/)
      .filter(w => w.length > 2 && !stopWords.has(w));

    const scored = events.map(ev => {
      let score = 0;

      // Attendee email match (strong signal)
      if (resolvedEmails.size > 0) {
        const evEmails = ev.attendees.map(a => a.email.toLowerCase());
        const matched = [...resolvedEmails].filter(e => evEmails.includes(e)).length;
        score += matched * 3;
      }

      // Project/title keyword match
      if (projectKeywords.length > 0) {
        const titleLower = ev.title.toLowerCase();
        const kwMatches = projectKeywords.filter(k => titleLower.includes(k)).length;
        score += kwMatches * 2;
      }

      return { ev, score };
    });

    const suggested = scored
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ ev }) => ev);

    setSuggestedMeetings(suggested);
  };

  if (!open) return null;

  const resetForm = () => {
    setText(""); setPerson(""); setTeam(parentTask?.team || ""); setProjectTag(parentTask?.project_tag || "");
    setPriority("Med"); setDueDate(""); setDueTime(""); setIsMeetingContext(false);
    setEndDate(""); setEndTime(""); setAttendeeEmails(""); setEventTitle("");
    setAddMeetLink(true); setIsAllDay(false); setContext(""); setValidUntil("");
    setLinkedMeetingId(""); setLinkedMeetingTitle(""); setShowAllMeetings(false);
  };

  const handleSave = async (toPending: boolean) => {
    if (!text.trim() && type !== "Event") { toast.error("Text is required"); return; }
    if (type === "Event" && !eventTitle.trim() && !text.trim()) { toast.error("Event title is required"); return; }
    setSaving(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error("Not authenticated"); return; }

      const personArr = person.split(",").map(s => s.trim()).filter(Boolean);
      const emailArr = attendeeEmails.split(",").map(s => s.trim()).filter(Boolean);
      const meetingLink = linkedMeetingId || null;

      if (type === "Decision") {
        if (toPending) {
          const inboxId = await generateId("INB", "inbox", "inbox_id");
          const { error } = await supabase.from("inbox").insert({
            inbox_id: inboxId, user_id: user.id, type: "Decision",
            parsed_text: text, person: personArr, team: team || null,
            project_tag: projectTag || null, is_meeting_context: isMeetingContext,
            status: "Pending",
          });
          if (error) throw error;
          toast.success("Decision saved to Pending Room");
        } else {
          const decId = await generateId("DEC", "decisions", "decision_id");
          const { error } = await supabase.from("decisions").insert({
            decision_id: decId, user_id: user.id, decision_text: text,
            team: team || null, person: personArr, project_tag: projectTag || null,
            context: context || null, is_meeting_context: isMeetingContext,
            source: "manual", valid_until: validUntil || null,
          } as any);
          if (error) throw error;
          toast.success("Decision recorded");
        }
      } else if (type === "Event") {
        const title = eventTitle.trim() || text.trim();
        if (toPending) {
          const inboxId = await generateId("INB", "inbox", "inbox_id");
          const { error } = await supabase.from("inbox").insert({
            inbox_id: inboxId, user_id: user.id, type: "CalendarEvent",
            parsed_text: text || title, calendar_event_title: title,
            person: personArr, email: emailArr, team: team || null,
            project_tag: projectTag || null, due_date: dueDate || null,
            due_time: isAllDay ? null : dueTime || null,
            is_meeting_context: true, status: "Pending",
          });
          if (error) throw error;
          toast.success("Event saved to Pending Room");
        } else {
          let calendarEventId: string | null = null;
          try {
            const calRes = await supabase.functions.invoke("create-calendar-event", {
              body: {
                title, description: text || "",
                startDate: dueDate || null, startTime: isAllDay ? null : dueTime || null,
                endDate: endDate || dueDate || null, endTime: isAllDay ? null : endTime || null,
                attendeeEmails: emailArr, addMeetLink,
              },
            });
            if (calRes.error) {
              toast.error("Calendar event could not be created, saving as task instead");
            } else if (calRes.data?.eventId) {
              calendarEventId = calRes.data.eventId;
              toast.success(calRes.data.meetLink ? "Event created with Meet link!" : "Google Calendar event created!");
            }
          } catch (calErr) {
            console.error("Calendar event error:", calErr);
          }

          const taskId = await generateId("TASK", "active_tasks", "task_id");
          const { error } = await supabase.from("active_tasks").insert({
            task_id: taskId, user_id: user.id, task: title,
            person: personArr, email: emailArr, team: team || null,
            project_tag: projectTag || null, priority: priority,
            due_date: dueDate || null, due_time: isAllDay ? null : dueTime || null,
            is_meeting_context: true, calendar_event_id: calendarEventId,
            parent_task_id: parentTask?.task_id || null, status: "Active",
            linked_meeting_id: meetingLink,
          } as any);
          if (error) throw error;
        }
      } else {
        // Task or FollowUp
        if (toPending) {
          const inboxId = await generateId("INB", "inbox", "inbox_id");
          const { error } = await supabase.from("inbox").insert({
            inbox_id: inboxId, user_id: user.id, type: "Task",
            parsed_text: text, person: personArr, team: team || null,
            project_tag: projectTag || null, priority,
            due_date: dueDate || null, due_time: dueTime || null,
            is_meeting_context: isMeetingContext, status: "Pending",
            linked_meeting_id: meetingLink,
          } as any);
          if (error) throw error;
          toast.success("Saved to Pending Room");
        } else {
          const taskId = await generateId("TASK", "active_tasks", "task_id");
          const { error } = await supabase.from("active_tasks").insert({
            task_id: taskId, user_id: user.id, task: text,
            person: personArr, team: team || null, project_tag: projectTag || null,
            priority, due_date: dueDate || null, due_time: dueTime || null,
            is_meeting_context: isMeetingContext,
            parent_task_id: parentTask?.task_id || null, status: "Active",
            linked_meeting_id: meetingLink,
          } as any);
          if (error) throw error;
          toast.success(type === "FollowUp" ? "Follow-up created" : "Task created");
        }
      }

      onCreated();
      onClose();
      resetForm();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const typeOptions: { id: ItemType; label: string; icon: any }[] = [
    { id: "Task", label: "Task", icon: ListTodo },
    { id: "Decision", label: "Decision", icon: CheckCircle },
    { id: "Event", label: "Event", icon: Calendar },
    { id: "FollowUp", label: "Follow-up", icon: ArrowRight },
  ];

  const timeSlots = Array.from({ length: 48 }, (_, i) => {
    const h = Math.floor(i / 2);
    const m = i % 2 === 0 ? "00" : "30";
    return `${String(h).padStart(2, "0")}:${m}`;
  });

  const formatTimeLabel = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
  };

  const formatEventDate = (start: string) => {
    try {
      const d = parseISO(start);
      if (isToday(d)) return "Today";
      if (isTomorrow(d)) return "Tomorrow";
      return format(d, "EEE, MMM d");
    } catch { return start; }
  };

  const formatEventTime = (start: string) => {
    try { return format(parseISO(start), "h:mm a"); }
    catch { return ""; }
  };

  // Meetings not in suggested list
  const otherMeetings = allMeetings.filter(e => !suggestedMeetings.find(s => s.id === e.id));

  const MeetingOption = ({ ev }: { ev: CalendarEvent }) => {
    const isSelected = linkedMeetingId === ev.id;
    return (
      <button
        onClick={() => {
          if (isSelected) { setLinkedMeetingId(""); setLinkedMeetingTitle(""); }
          else { setLinkedMeetingId(ev.id); setLinkedMeetingTitle(ev.title); }
        }}
        className={`w-full text-left px-3 py-2 rounded-lg border text-xs transition-all ${
          isSelected
            ? "border-primary bg-primary/5 text-primary"
            : "border-border hover:border-primary/40 hover:bg-muted/50"
        }`}
      >
        <div className="font-medium truncate">{ev.title}</div>
        <div className="text-muted-foreground mt-0.5">
          {formatEventDate(ev.start)} · {formatEventTime(ev.start)}
        </div>
      </button>
    );
  };

  const showMeetingLinker = type !== "Decision";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-foreground/50" onClick={onClose} />
      <div className="relative bg-card rounded-xl shadow-xl w-full max-w-lg p-6 animate-slide-up max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">
            {parentTask ? "New Follow-up" : "New Item"}
          </h3>
          <button onClick={onClose}><X className="w-5 h-5 text-muted-foreground" /></button>
        </div>

        {/* Type selector */}
        {!parentTask && (
          <div className="flex gap-1 mb-4 bg-muted p-1 rounded-lg">
            {typeOptions.map(t => (
              <button
                key={t.id}
                onClick={() => setType(t.id)}
                className={`flex items-center gap-1.5 flex-1 px-2 py-1.5 rounded-md text-xs font-medium transition-all ${
                  type === t.id ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <t.icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            ))}
          </div>
        )}

        <div className="space-y-3">
          {/* Event title */}
          {type === "Event" && (
            <div>
              <label className="text-xs text-muted-foreground font-medium">Event Title</label>
              <Input value={eventTitle} onChange={e => setEventTitle(e.target.value)} className="mt-1" placeholder="Meeting title" />
            </div>
          )}

          <div>
            <label className="text-xs text-muted-foreground font-medium">
              {type === "Decision" ? "Decision" : type === "Event" ? "Description" : "Task"}
            </label>
            <Textarea value={text} onChange={e => setText(e.target.value)} className="mt-1" rows={2}
              placeholder={type === "Decision" ? "What was decided?" : type === "Event" ? "Event description (optional)" : "What needs to be done?"} />
          </div>

          {/* Decision context */}
          {type === "Decision" && (
            <>
              <div>
                <label className="text-xs text-muted-foreground font-medium">Context</label>
                <Input value={context} onChange={e => setContext(e.target.value)} className="mt-1" placeholder="Why was this decided?" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground font-medium">Valid Until (optional)</label>
                <Input type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} className="mt-1" />
                <p className="text-[10px] text-muted-foreground mt-0.5">Decision will be flagged as expired after this date</p>
              </div>
            </>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground font-medium">Person</label>
              <Input value={person} onChange={e => setPerson(e.target.value)} className="mt-1" placeholder="Comma separated" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground font-medium">Team</label>
              <Input value={team} onChange={e => setTeam(e.target.value)} className="mt-1" />
            </div>
          </div>

          {/* Event-specific emails */}
          {type === "Event" && (
            <div>
              <label className="text-xs text-muted-foreground font-medium">Attendee Emails</label>
              <Input value={attendeeEmails} onChange={e => setAttendeeEmails(e.target.value)} className="mt-1" placeholder="email1@example.com, email2@example.com" />
            </div>
          )}

          {/* Date/time */}
          {type === "Event" ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Switch checked={isAllDay} onCheckedChange={setIsAllDay} />
                  <span className="text-xs text-muted-foreground">All-day event</span>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={addMeetLink} onCheckedChange={setAddMeetLink} />
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Video className="w-3 h-3" /> Add Meet link
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground font-medium">Start Date</label>
                  <Input type="date" value={dueDate} onChange={e => { setDueDate(e.target.value); if (!endDate) setEndDate(e.target.value); }} className="mt-1" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground font-medium">End Date</label>
                  <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="mt-1" min={dueDate} />
                </div>
              </div>
              {!isAllDay && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground font-medium">Start Time</label>
                    <Select value={dueTime} onValueChange={v => {
                      setDueTime(v);
                      const idx = timeSlots.indexOf(v);
                      if (idx >= 0 && idx + 2 < timeSlots.length && !endTime) setEndTime(timeSlots[idx + 2]);
                    }}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Select time" /></SelectTrigger>
                      <SelectContent className="max-h-60">
                        {timeSlots.map(t => <SelectItem key={t} value={t}>{formatTimeLabel(t)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground font-medium">End Time</label>
                    <Select value={endTime} onValueChange={setEndTime}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Select time" /></SelectTrigger>
                      <SelectContent className="max-h-60">
                        {timeSlots.map(t => <SelectItem key={t} value={t}>{formatTimeLabel(t)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
            </div>
          ) : type !== "Decision" ? (
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-muted-foreground font-medium">Project</label>
                <Input value={projectTag} onChange={e => setProjectTag(e.target.value)} className="mt-1" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground font-medium">Priority</label>
                <div className="flex gap-1 mt-1">
                  {["High", "Med", "Low"].map(p => (
                    <button key={p} onClick={() => setPriority(p)}
                      className={`flex-1 text-xs py-1.5 rounded font-medium transition-all ${
                        priority === p
                          ? p === "High" ? "bg-destructive/20 text-destructive" : p === "Med" ? "bg-warning/20 text-warning" : "bg-success/20 text-success"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >{getPriorityEmoji(p)}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground font-medium">Due Date</label>
                <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="mt-1" />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground font-medium">Project</label>
                <Input value={projectTag} onChange={e => setProjectTag(e.target.value)} className="mt-1" />
              </div>
              <div className="flex items-end">
                <div className="flex items-center gap-2 pb-1">
                  <Switch checked={isMeetingContext} onCheckedChange={setIsMeetingContext} />
                  <span className="text-xs text-muted-foreground">Meeting Context</span>
                </div>
              </div>
            </div>
          )}

          {type !== "Decision" && type !== "Event" && (
            <div className="flex items-center gap-2">
              <Switch checked={isMeetingContext} onCheckedChange={setIsMeetingContext} />
              <span className="text-xs text-muted-foreground">Meeting Context</span>
            </div>
          )}

          {type === "Event" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground font-medium">Project</label>
                <Input value={projectTag} onChange={e => setProjectTag(e.target.value)} className="mt-1" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground font-medium">Priority</label>
                <div className="flex gap-1 mt-1">
                  {["High", "Med", "Low"].map(p => (
                    <button key={p} onClick={() => setPriority(p)}
                      className={`flex-1 text-xs py-1.5 rounded font-medium transition-all ${
                        priority === p
                          ? p === "High" ? "bg-destructive/20 text-destructive" : p === "Med" ? "bg-warning/20 text-warning" : "bg-success/20 text-success"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >{getPriorityEmoji(p)}</button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Meeting linker ── */}
          {showMeetingLinker && (
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
                <Link2 className="w-3 h-3" />
                Link to Meeting
                {linkedMeetingId && (
                  <Badge variant="secondary" className="text-[10px] h-4 ml-1">linked</Badge>
                )}
              </label>

              {/* Selected meeting pill */}
              {linkedMeetingId && (
                <div className="flex items-center gap-2 px-3 py-2 bg-primary/5 border border-primary/20 rounded-lg">
                  <Calendar className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                  <span className="text-xs font-medium text-primary flex-1 truncate">{linkedMeetingTitle}</span>
                  <button
                    onClick={() => { setLinkedMeetingId(""); setLinkedMeetingTitle(""); }}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {meetingsLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading meetings…
                </div>
              ) : allMeetings.length === 0 ? (
                <p className="text-xs text-muted-foreground py-1">
                  No upcoming meetings found. Connect Google Calendar in the Meetings tab.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {suggestedMeetings.length > 0 && (
                    <>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">
                        Suggested · matched on {person ? "person" : ""}{person && projectTag ? " & " : ""}{projectTag ? "project" : ""}
                      </p>
                      {suggestedMeetings.slice(0, 3).map(ev => (
                        <MeetingOption key={ev.id} ev={ev} />
                      ))}
                    </>
                  )}

                  {otherMeetings.length > 0 && (
                    <>
                      <button
                        onClick={() => setShowAllMeetings(v => !v)}
                        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors mt-1"
                      >
                        {showAllMeetings
                          ? <><ChevronUp className="w-3 h-3" /> Hide all meetings</>
                          : <><ChevronDown className="w-3 h-3" /> Show all meetings ({allMeetings.length})</>
                        }
                      </button>
                      {showAllMeetings && (
                        <div className="space-y-1.5 pt-1 max-h-48 overflow-y-auto">
                          {otherMeetings.map(ev => (
                            <MeetingOption key={ev.id} ev={ev} />
                          ))}
                        </div>
                      )}
                    </>
                  )}

                  {suggestedMeetings.length === 0 && !showAllMeetings && (
                    <p className="text-xs text-muted-foreground">
                      No matches found. Fill in Person or Project to get suggestions, or{" "}
                      <button
                        onClick={() => setShowAllMeetings(true)}
                        className="text-primary underline-offset-2 hover:underline"
                      >
                        browse all {allMeetings.length} meetings
                      </button>.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-2 mt-6">
          {type !== "Decision" && (
            <Button variant="outline" className="flex-1" onClick={() => handleSave(true)} disabled={saving}>
              Save to Pending
            </Button>
          )}
          <Button className="flex-1" onClick={() => handleSave(false)} disabled={saving}>
            {type === "Decision" ? "Record Decision" : type === "Event" ? "Create Event" : "Save to Active"}
          </Button>
        </div>
      </div>
    </div>
  );
}

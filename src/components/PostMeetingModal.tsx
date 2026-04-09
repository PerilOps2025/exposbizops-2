import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, X, CheckCircle, MessageSquare, ListTodo, Lightbulb } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface FollowUp {
  text: string;
  person: string;
  priority: string;
  due_date: string;
}

interface Decision {
  text: string;
  context: string;
}

interface PostMeetingModalProps {
  open: boolean;
  onClose: () => void;
  meetingTitle: string;
  meetingId?: string;
  attendees?: string[];
  onSaved?: () => void;
}

export default function PostMeetingModal({ open, onClose, meetingTitle, meetingId, attendees = [], onSaved }: PostMeetingModalProps) {
  const [voiceNote, setVoiceNote] = useState("");
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [openItems, setOpenItems] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const addDecision = () => setDecisions(prev => [...prev, { text: "", context: "" }]);
  const removeDecision = (i: number) => setDecisions(prev => prev.filter((_, idx) => idx !== i));
  const updateDecision = (i: number, field: keyof Decision, val: string) =>
    setDecisions(prev => prev.map((d, idx) => idx === i ? { ...d, [field]: val } : d));

  const addFollowUp = () => setFollowUps(prev => [...prev, { text: "", person: "", priority: "Med", due_date: "" }]);
  const removeFollowUp = (i: number) => setFollowUps(prev => prev.filter((_, idx) => idx !== i));
  const updateFollowUp = (i: number, field: keyof FollowUp, val: string) =>
    setFollowUps(prev => prev.map((f, idx) => idx === i ? { ...f, [field]: val } : f));

  const addOpenItem = () => setOpenItems(prev => [...prev, ""]);
  const removeOpenItem = (i: number) => setOpenItems(prev => prev.filter((_, idx) => idx !== i));
  const updateOpenItem = (i: number, val: string) =>
    setOpenItems(prev => prev.map((item, idx) => idx === i ? val : item));

  const handleSave = async () => {
    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const ts = Date.now().toString(36);
      const rand = Math.random().toString(36).substring(2, 6);

      // Save decisions
      for (const dec of decisions) {
        if (!dec.text.trim()) continue;
        const decId = `DEC-${ts}-${Math.random().toString(36).substring(2, 6)}`;
        await supabase.from("decisions").insert({
          decision_id: decId,
          user_id: user.id,
          decision_text: dec.text,
          context: dec.context || null,
          source: "post_meeting",
          is_meeting_context: true,
          person: attendees.length > 0 ? attendees : [],
        });
      }

      // Save follow-up tasks
      const spawnedIds: string[] = [];
      for (const fu of followUps) {
        if (!fu.text.trim()) continue;
        const taskId = `TASK-${ts}-${Math.random().toString(36).substring(2, 6)}`;
        await supabase.from("active_tasks").insert({
          task_id: taskId,
          user_id: user.id,
          task: fu.text,
          person: fu.person ? fu.person.split(",").map(s => s.trim()).filter(Boolean) : [],
          priority: fu.priority,
          due_date: fu.due_date || null,
          is_meeting_context: true,
          status: "Active",
        });
        spawnedIds.push(taskId);
      }

      // Update meeting log if we have a meeting ID
      if (meetingId) {
        const mId = `MTG-${ts}-${rand}`;
        await supabase.from("meeting_log").upsert({
          meeting_id: meetingId,
          user_id: user.id,
          meeting_title: meetingTitle,
          voice_note: voiceNote || null,
          decisions_made: decisions.filter(d => d.text.trim()).map(d => d.text),
          tasks_discussed: spawnedIds,
          open_items_carried_forward: openItems.filter(i => i.trim()),
          post_meeting_note_added: true,
          actual_end: new Date().toISOString(),
        }, { onConflict: "meeting_id,user_id" });
      }

      toast.success("Post-meeting notes saved!");
      onSaved?.();
      resetAndClose();
    } catch (err: any) {
      console.error("Post-meeting save error:", err);
      toast.error("Failed to save: " + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const resetAndClose = () => {
    setVoiceNote("");
    setDecisions([]);
    setFollowUps([]);
    setOpenItems([]);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && resetAndClose()}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-primary" />
            Post-Meeting Wrap-up
          </DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">{meetingTitle}</p>
        </DialogHeader>

        <div className="space-y-5">
          {/* Quick Voice Note */}
          <div>
            <label className="text-sm font-medium flex items-center gap-1.5 mb-1.5">
              <MessageSquare className="w-3.5 h-3.5" /> Quick Summary / Notes
            </label>
            <Textarea
              value={voiceNote}
              onChange={e => setVoiceNote(e.target.value)}
              placeholder="Key takeaways from the meeting..."
              rows={3}
            />
          </div>

          {/* Decisions Made */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium flex items-center gap-1.5">
                <CheckCircle className="w-3.5 h-3.5 text-success" /> Decisions Made
              </label>
              <Button variant="ghost" size="sm" onClick={addDecision} className="gap-1 h-7 text-xs">
                <Plus className="w-3.5 h-3.5" /> Add
              </Button>
            </div>
            {decisions.map((dec, i) => (
              <div key={i} className="mb-2 p-3 border border-border rounded-lg space-y-2">
                <div className="flex items-center gap-2">
                  <Input
                    value={dec.text}
                    onChange={e => updateDecision(i, "text", e.target.value)}
                    placeholder="What was decided?"
                    className="flex-1"
                  />
                  <button onClick={() => removeDecision(i)} className="text-muted-foreground hover:text-destructive">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <Input
                  value={dec.context}
                  onChange={e => updateDecision(i, "context", e.target.value)}
                  placeholder="Context / rationale (optional)"
                  className="text-sm"
                />
              </div>
            ))}
            {decisions.length === 0 && (
              <p className="text-xs text-muted-foreground italic">No decisions recorded yet</p>
            )}
          </div>

          {/* Follow-up Tasks */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium flex items-center gap-1.5">
                <ListTodo className="w-3.5 h-3.5 text-primary" /> Follow-up Tasks
              </label>
              <Button variant="ghost" size="sm" onClick={addFollowUp} className="gap-1 h-7 text-xs">
                <Plus className="w-3.5 h-3.5" /> Add
              </Button>
            </div>
            {followUps.map((fu, i) => (
              <div key={i} className="mb-2 p-3 border border-border rounded-lg space-y-2">
                <div className="flex items-center gap-2">
                  <Input
                    value={fu.text}
                    onChange={e => updateFollowUp(i, "text", e.target.value)}
                    placeholder="Follow-up task"
                    className="flex-1"
                  />
                  <button onClick={() => removeFollowUp(i)} className="text-muted-foreground hover:text-destructive">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <Input
                    value={fu.person}
                    onChange={e => updateFollowUp(i, "person", e.target.value)}
                    placeholder="Person"
                  />
                  <Select value={fu.priority} onValueChange={v => updateFollowUp(i, "priority", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="High">🔴 High</SelectItem>
                      <SelectItem value="Med">🟡 Med</SelectItem>
                      <SelectItem value="Low">🟢 Low</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input type="date" value={fu.due_date} onChange={e => updateFollowUp(i, "due_date", e.target.value)} />
                </div>
              </div>
            ))}
            {followUps.length === 0 && (
              <p className="text-xs text-muted-foreground italic">No follow-ups yet</p>
            )}
          </div>

          {/* Open Items / Carry Forward */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium flex items-center gap-1.5">
                <Lightbulb className="w-3.5 h-3.5 text-warning" /> Open Items (Carry Forward)
              </label>
              <Button variant="ghost" size="sm" onClick={addOpenItem} className="gap-1 h-7 text-xs">
                <Plus className="w-3.5 h-3.5" /> Add
              </Button>
            </div>
            {openItems.map((item, i) => (
              <div key={i} className="mb-2 flex items-center gap-2">
                <Input
                  value={item}
                  onChange={e => updateOpenItem(i, e.target.value)}
                  placeholder="Item to carry forward to next meeting"
                  className="flex-1"
                />
                <button onClick={() => removeOpenItem(i)} className="text-muted-foreground hover:text-destructive">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
            {openItems.length === 0 && (
              <p className="text-xs text-muted-foreground italic">No open items</p>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 mt-4">
          <Button variant="outline" onClick={resetAndClose} disabled={submitting}>Skip</Button>
          <Button onClick={handleSave} disabled={submitting}>
            {submitting ? "Saving..." : "Save Notes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

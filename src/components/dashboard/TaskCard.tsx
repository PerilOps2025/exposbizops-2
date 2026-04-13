import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Lock, AlertCircle, CheckCircle, ChevronDown, ChevronUp, Link2, Pencil, Trash2, X, Save } from "lucide-react";
import { getPriorityEmoji, isOverdue } from "@/lib/supabase-helpers";
import { format, formatDistanceToNow } from "date-fns";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import TaskCompletionModal from "@/components/TaskCompletionModal";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface TaskCardProps {
  task: any;
  showOverdue?: boolean;
  onTaskCompleted?: () => void;
  onTaskUpdated?: () => void;
}

export default function TaskCard({ task, showOverdue, onTaskCompleted, onTaskUpdated }: TaskCardProps) {
  const [showModal, setShowModal] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Editable fields
  const [editTask, setEditTask] = useState(task.task || "");
  const [editPerson, setEditPerson] = useState((task.person || []).join(", "));
  const [editTeam, setEditTeam] = useState(task.team || "");
  const [editProject, setEditProject] = useState(task.project_tag || "");
  const [editPriority, setEditPriority] = useState(task.priority || "Med");
  const [editDueDate, setEditDueDate] = useState(task.due_date || "");
  const [editStatus, setEditStatus] = useState(task.status || "Active");

  const overdue = isOverdue(task.due_date, task.status);
  const taskText = task.task || "";
  const isLong = taskText.length > 100;

  const startEdit = () => {
    // Reset to current task values
    setEditTask(task.task || "");
    setEditPerson((task.person || []).join(", "));
    setEditTeam(task.team || "");
    setEditProject(task.project_tag || "");
    setEditPriority(task.priority || "Med");
    setEditDueDate(task.due_date || "");
    setEditStatus(task.status || "Active");
    setEditing(true);
  };

  const cancelEdit = () => setEditing(false);

  const saveEdit = async () => {
    if (!editTask.trim()) { toast.error("Task text is required"); return; }
    setSaving(true);
    try {
      const personArr = editPerson.split(",").map(s => s.trim()).filter(Boolean);
      const { error } = await supabase
        .from("active_tasks")
        .update({
          task: editTask.trim(),
          person: personArr,
          team: editTeam.trim() || null,
          project_tag: editProject.trim() || null,
          priority: editPriority,
          due_date: editDueDate || null,
          status: editStatus,
          updated_at: new Date().toISOString(),
        })
        .eq("task_id", task.task_id);
      if (error) throw error;
      toast.success("Task updated");
      setEditing(false);
      onTaskUpdated?.();
    } catch (err: any) {
      toast.error(err.message || "Failed to update task");
    } finally {
      setSaving(false);
    }
  };

  const deleteTask = async () => {
    setDeleting(true);
    try {
      const { error } = await supabase
        .from("active_tasks")
        .delete()
        .eq("task_id", task.task_id);
      if (error) throw error;
      toast.success("Task deleted");
      onTaskUpdated?.();
    } catch (err: any) {
      toast.error(err.message || "Failed to delete task");
    } finally {
      setDeleting(false);
      setShowDeleteDialog(false);
    }
  };

  return (
    <TooltipProvider>
      <>
        <Card className={`p-3 hover:shadow-md transition-shadow ${overdue ? 'border-destructive/30' : ''}`}>
          {editing ? (
            /* ── Edit mode ── */
            <div className="space-y-2">
              <Input
                value={editTask}
                onChange={e => setEditTask(e.target.value)}
                className="text-sm font-medium"
                placeholder="Task description"
                autoFocus
              />
              <div className="grid grid-cols-2 gap-2">
                <Input
                  value={editPerson}
                  onChange={e => setEditPerson(e.target.value)}
                  className="text-xs"
                  placeholder="Person(s), comma-sep"
                />
                <Input
                  value={editProject}
                  onChange={e => setEditProject(e.target.value)}
                  className="text-xs"
                  placeholder="Project tag"
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Select value={editPriority} onValueChange={setEditPriority}>
                  <SelectTrigger className="text-xs h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="High">🔴 High</SelectItem>
                    <SelectItem value="Med">🟡 Med</SelectItem>
                    <SelectItem value="Low">🟢 Low</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={editStatus} onValueChange={setEditStatus}>
                  <SelectTrigger className="text-xs h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Active">Active</SelectItem>
                    <SelectItem value="WaitingOn">Waiting On</SelectItem>
                    <SelectItem value="Blocked">Blocked</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  type="date"
                  value={editDueDate}
                  onChange={e => setEditDueDate(e.target.value)}
                  className="text-xs h-8"
                />
              </div>
              <div className="flex gap-2 justify-end pt-1">
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={cancelEdit} disabled={saving}>
                  <X className="w-3 h-3" /> Cancel
                </Button>
                <Button size="sm" className="h-7 px-2 text-xs gap-1" onClick={saveEdit} disabled={saving}>
                  <Save className="w-3 h-3" /> {saving ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
          ) : (
            /* ── View mode ── */
            <div className="flex items-start gap-3">
              <span className="text-base mt-0.5">{getPriorityEmoji(task.priority)}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-start gap-2">
                  <p className={`text-sm font-medium break-words ${!expanded && isLong ? 'line-clamp-2' : ''}`}>{taskText}</p>
                  {task.status === 'Blocked' && (
                    <Lock className="w-3.5 h-3.5 text-destructive flex-shrink-0 mt-0.5" />
                  )}
                  {overdue && (
                    <AlertCircle className="w-3.5 h-3.5 text-destructive flex-shrink-0 mt-0.5" />
                  )}
                </div>
                {isLong && (
                  <button onClick={() => setExpanded(!expanded)} className="text-xs text-primary hover:underline mt-0.5 flex items-center gap-0.5">
                    {expanded ? <><ChevronUp className="w-3 h-3" /> Less</> : <><ChevronDown className="w-3 h-3" /> More</>}
                  </button>
                )}
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {task.person?.length > 0 && (
                    <span className="text-xs text-muted-foreground">{task.person.join(', ')}</span>
                  )}
                  {task.team && (
                    <Badge variant="secondary" className="text-[10px] h-5">{task.team}</Badge>
                  )}
                  {task.project_tag && (
                    <Badge variant="outline" className="text-[10px] h-5">{task.project_tag}</Badge>
                  )}
                  {task.due_date && (
                    <span className={`text-xs ${overdue ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
                      {format(new Date(task.due_date), 'MMM d')}
                    </span>
                  )}
                  {task.parent_task_id && (
                    <Badge variant="outline" className="text-[10px] h-5 border-primary/30 text-primary">Follow-up</Badge>
                  )}
                  {task.linked_meeting_id && (
                    <Badge variant="outline" className="text-[10px] h-5 border-accent-foreground/30 gap-0.5">
                      <Link2 className="w-2.5 h-2.5" /> Meeting
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1">
                  {task.created_at && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-[10px] text-muted-foreground cursor-default">
                          Created {formatDistanceToNow(new Date(task.created_at), { addSuffix: true })}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{format(new Date(task.created_at), 'MMM d, yyyy h:mm a')}</TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-1 flex-shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                  onClick={startEdit}
                  title="Edit task"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                  onClick={() => setShowDeleteDialog(true)}
                  title="Delete task"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-success"
                  onClick={() => setShowModal(true)}
                >
                  <CheckCircle className="w-3.5 h-3.5" />
                  Done
                </Button>
              </div>
            </div>
          )}
        </Card>

        <TaskCompletionModal
          open={showModal}
          onClose={() => setShowModal(false)}
          task={task}
          onCompleted={() => onTaskCompleted?.()}
        />

        <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete task?</AlertDialogTitle>
              <AlertDialogDescription>
                "<span className="font-medium text-foreground">{task.task}</span>" will be permanently deleted. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={deleteTask}
                disabled={deleting}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleting ? "Deleting…" : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    </TooltipProvider>
  );
}

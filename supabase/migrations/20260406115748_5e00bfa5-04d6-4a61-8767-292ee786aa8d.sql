
-- Create update_updated_at function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- 1. MASTER_LOG
CREATE TABLE public.master_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  raw_text TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'voice' CHECK (source IN ('voice', 'manual', 'offline_sync')),
  processed_by TEXT NOT NULL DEFAULT 'pending' CHECK (processed_by IN ('gemini', 'pending')),
  inbox_refs TEXT[] DEFAULT '{}'
);
ALTER TABLE public.master_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own master_log" ON public.master_log FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 2. INBOX
CREATE TABLE public.inbox (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  inbox_id TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  master_log_ref UUID REFERENCES public.master_log(id),
  type TEXT NOT NULL DEFAULT 'Task' CHECK (type IN ('Task', 'Decision', 'CalendarEvent')),
  raw_fragment TEXT,
  parsed_text TEXT,
  person TEXT[] DEFAULT '{}',
  person_is_new BOOLEAN DEFAULT false,
  person_collision BOOLEAN DEFAULT false,
  team TEXT,
  team_is_new BOOLEAN DEFAULT false,
  project_tag TEXT,
  priority TEXT DEFAULT 'Med' CHECK (priority IN ('High', 'Med', 'Low')),
  due_date DATE,
  due_time TIME,
  due_is_vague BOOLEAN DEFAULT false,
  is_meeting_context BOOLEAN DEFAULT false,
  invite_person BOOLEAN DEFAULT false,
  calendar_event_title TEXT,
  blocked_by_desc TEXT,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Confirmed', 'Discarded')),
  gemini_feedback TEXT CHECK (gemini_feedback IN ('up', 'down')),
  feedback_detail TEXT
);
ALTER TABLE public.inbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own inbox" ON public.inbox FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 3. ACTIVE_TASKS
CREATE TABLE public.active_tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  task_id TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  team TEXT,
  person TEXT[] DEFAULT '{}',
  email TEXT[] DEFAULT '{}',
  task TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'WaitingOn', 'Blocked', 'Done', 'Overdue')),
  priority TEXT DEFAULT 'Med' CHECK (priority IN ('High', 'Med', 'Low')),
  due_date DATE,
  due_time TIME,
  is_meeting_context BOOLEAN DEFAULT false,
  project_tag TEXT,
  parent_task_id TEXT,
  blocked_by TEXT[] DEFAULT '{}',
  blocks TEXT[] DEFAULT '{}',
  waiting_since TIMESTAMP WITH TIME ZONE,
  reassigned_from TEXT,
  reassigned_reason TEXT,
  recurrence TEXT DEFAULT 'None' CHECK (recurrence IN ('None', 'Daily', 'Weekly', 'Monthly', 'Custom')),
  recurrence_custom TEXT,
  inbox_ref TEXT,
  calendar_event_id TEXT
);
ALTER TABLE public.active_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own active_tasks" ON public.active_tasks FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER update_active_tasks_updated_at BEFORE UPDATE ON public.active_tasks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. DECISIONS
CREATE TABLE public.decisions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  decision_id TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  team TEXT,
  project_tag TEXT,
  person TEXT[] DEFAULT '{}',
  context TEXT,
  decision_text TEXT NOT NULL,
  supersedes_id TEXT,
  superseded_by_id TEXT,
  source TEXT DEFAULT 'voice_transcript' CHECK (source IN ('voice_transcript', 'completion_note', 'manual')),
  is_meeting_context BOOLEAN DEFAULT false,
  visible_in TEXT[] DEFAULT '{decision_feed}'
);
ALTER TABLE public.decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own decisions" ON public.decisions FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 5. MEETING_LOG
CREATE TABLE public.meeting_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  meeting_id TEXT NOT NULL UNIQUE,
  scheduled_start TIMESTAMP WITH TIME ZONE,
  scheduled_end TIMESTAMP WITH TIME ZONE,
  actual_end TIMESTAMP WITH TIME ZONE,
  meeting_title TEXT,
  keywords TEXT[] DEFAULT '{}',
  teams TEXT[] DEFAULT '{}',
  projects TEXT[] DEFAULT '{}',
  was_manually_ended BOOLEAN DEFAULT false,
  post_meeting_note_added BOOLEAN DEFAULT false,
  voice_note TEXT,
  auto_summary TEXT,
  tasks_discussed TEXT[] DEFAULT '{}',
  decisions_made TEXT[] DEFAULT '{}',
  open_items_carried_forward TEXT[] DEFAULT '{}',
  duration_minutes INTEGER
);
ALTER TABLE public.meeting_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own meeting_log" ON public.meeting_log FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 6. ARCHIVE
CREATE TABLE public.archive (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  task_id TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE,
  team TEXT,
  person TEXT[] DEFAULT '{}',
  task TEXT,
  status TEXT,
  priority TEXT,
  due_date DATE,
  project_tag TEXT,
  parent_task_id TEXT,
  recurrence TEXT,
  inbox_ref TEXT,
  archived_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completion_note TEXT,
  completion_note_type TEXT CHECK (completion_note_type IN ('Meeting Context', 'Decision Made', 'Follow-up Needed', 'For Record Only')),
  completion_tags_team TEXT,
  completion_tags_person TEXT,
  completion_tags_project_tag TEXT,
  visible_in TEXT[] DEFAULT '{}',
  spawned_task_ids TEXT[] DEFAULT '{}'
);
ALTER TABLE public.archive ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own archive" ON public.archive FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 7. CONFIG
CREATE TABLE public.config (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  key TEXT NOT NULL,
  value JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, key)
);
ALTER TABLE public.config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own config" ON public.config FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER update_config_updated_at BEFORE UPDATE ON public.config FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 8. TASK_AUDIT
CREATE TABLE public.task_audit (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  task_id TEXT NOT NULL,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  edit_source TEXT DEFAULT 'dashboard' CHECK (edit_source IN ('pending_room', 'dashboard', 'manual', 'system'))
);
ALTER TABLE public.task_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own task_audit" ON public.task_audit FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

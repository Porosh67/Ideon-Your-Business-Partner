// ── Shared TypeScript types for the Ideon app ──

// ── API response types (from Edge Functions) ──

export interface Competitor {
  name: string;
  positioning: string;
  strengths: string;
  weaknesses: string;
}

export interface FirstStep {
  title: string;
  description: string;
}

// ── Premium features (Market Reality Check + Competitor Snapshot) ──

export type RealityLevel = 'Low' | 'Medium' | 'High';

export interface RealityScore {
  /** 1–10 numeric score. */
  score: number;
  /** Human-readable label (Low / Medium / High) for quick scanning. */
  label: RealityLevel;
  /** One-line explanation grounded in the research. */
  reason: string;
}

export interface MarketRealityCheck {
  demand: RealityScore;
  competition: RealityScore;
  execution: RealityScore;
  /** Overall verdict: "Yes", "Maybe", or "No" with a one-line explanation. */
  worth_pursuing: {
    verdict: 'Yes' | 'Maybe' | 'No';
    reason: string;
  };
}

export interface CompetitorSnapshotItem {
  name: string;
  /** Pricing signal from research, or "Not publicly clear" if unknown. */
  pricing: string;
  /** One-line positioning vs the user's idea. */
  difference: string;
}


export interface BusinessPlanResult {
  target_customer: string;
  cost_estimate: string;
  competitor_summary: Competitor[];
  first_steps: FirstStep[];
  idea_text?: string;
  generated_at?: string;
  reality_check?: MarketRealityCheck | null;
  competitor_snapshot?: CompetitorSnapshotItem[] | null;
}

export interface Skill {
  skill: string;
  reason: string;
}

export interface ChecklistTask {
  task: string;
  done?: boolean;
}

export interface RoadmapResult {
  skills_to_learn: Skill[];
  checklist_30_days: ChecklistTask[];
  skill_gap_summary: string;
  generated_at?: string;
}

// ── DB row types (matching the Supabase schema) ──

export interface BusinessIdeaRow {
  id: string;
  user_id: string;
  idea_text: string;
  title: string | null;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
}

export interface BusinessPlanRow {
  id: string;
  idea_id: string;
  user_id: string;
  target_customer: string | null;
  cost_estimate: string | null;
  competitor_summary: Competitor[] | null;
  first_steps: FirstStep[] | null;
  raw_research_data: unknown;
  reality_check: MarketRealityCheck | null;
  competitor_snapshot: CompetitorSnapshotItem[] | null;
  created_at: string;
}

export interface RoadmapRow {
  id: string;
  plan_id: string;
  user_id: string;
  skills_to_learn: Skill[] | null;
  checklist_30_days: ChecklistTask[] | null;
  skill_gap_summary: string | null;
  created_at: string;
}

export interface CheckinRow {
  id: string;
  user_id: string;
  checkin_date: string;
  mood: number;
  energy: number;
  notes: string | null;
  title: string | null;
  is_pinned: boolean;
  ai_response: string | null;
  created_at: string;
}

export interface ChecklistProgressRow {
  id: string;
  roadmap_id: string;
  user_id: string;
  task_index: number;
  is_done: boolean;
  updated_at: string;
}

// ── Composite view (for IdeaView page) ──

export interface IdeaPlanView {
  idea: BusinessIdeaRow;
  plan: BusinessPlanRow | null;
  roadmap: RoadmapRow | null;
}
// ── Plan Chat ──

export interface PlanChatMessage {
  id: string;
  plan_id: string;
  user_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

// ── Dashboard conversations (chat threads) ──

export interface ConversationRow {
  id: string;
  user_id: string;
  idea_id: string | null;
  title: string | null;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
}

export interface ConversationMessageRow {
  id: string;
  conversation_id: string;
  user_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

// ── assistant-chat edge function responses ──

export interface ChatClassifyResult {
  phase: 'classify';
  category: 'A' | 'B' | 'C';
  idea_text: string | null;
  /** True when the latest message needs CURRENT/real-time information (live web search). */
  needs_web?: boolean;
  /** True when the latest message loosely references past saved work (semantic memory). */
  needs_memory?: boolean;
  /** Concise web-search query used when needs_web is true. */
  search_query?: string | null;
}

export interface ChatResearchResult {
  phase: 'research';
  research: unknown;
}

/**
 * Combined classify + reply fast path (phase 'chat'). One edge-function call
 * classifies the message AND returns the answer inline whenever no extra data
 * is needed (category B idea suggestions, or general C chat). `reply` is null
 * when the message needs the full pipeline (A), live web search, or memory —
 * the client then falls back to the dedicated phases.
 */
export interface ChatCombinedResult {
  phase: 'chat';
  category: 'A' | 'B' | 'C';
  idea_text: string | null;
  needs_web?: boolean;
  needs_memory?: boolean;
  search_query?: string | null;
  reply: string | null;
}

export interface ChatReplyResult {
  phase: 'reply';
  reply: string;
}

export interface ChatPlanResult {
  phase: 'plan';
  idea_id: string | null;
  plan: BusinessPlanResult;
  roadmap: RoadmapResult;
  reply: string;
  reality_check?: MarketRealityCheck | null;
  competitor_snapshot?: CompetitorSnapshotItem[] | null;
}

export type ChatResult =
  | ChatClassifyResult
  | ChatCombinedResult
  | ChatResearchResult
  | ChatReplyResult
  | ChatPlanResult;

// ── Chat file/photo attachments (step 5) ──

export type AttachmentKind = 'image' | 'document';

/** A file picked in the composer but not yet sent. */
export interface AttachmentDraft {
  id: string;
  file: File;
  kind: AttachmentKind;
  /** Object URL for image thumbnails (revoked on remove). */
  previewUrl?: string;
}

/** A file uploaded to storage and linked to a chat message. */
export interface ChatAttachmentRow {
  id: string;
  user_id: string;
  message_id: string | null;
  conversation_id: string | null;
  file_name: string;
  file_path: string;
  mime_type: string;
  file_size: number;
  kind: AttachmentKind;
  created_at: string;
}

/** Response from the chat-attachment edge function (action: analyze). */
export interface ChatAttachmentProcessed {
  id: string;
  kind: AttachmentKind;
  file_name: string;
  char_count?: number;
  chunk_count?: number;
}

export interface ChatAttachmentResult {
  reply: string;
  processed: ChatAttachmentProcessed[];
}

// ── Generated Reports (for /reports page) ──

export interface GeneratedReportRow {
  id: string;           // plan id
  idea_id: string;
  user_id: string;
  idea_text: string;
  idea_title: string | null;
  target_customer: string | null;
  cost_estimate: string | null;
  competitor_summary: Competitor[] | null;
  first_steps: FirstStep[] | null;
  reality_check: MarketRealityCheck | null;
  competitor_snapshot: CompetitorSnapshotItem[] | null;
  skills_to_learn: Skill[] | null;
  checklist_30_days: ChecklistTask[] | null;
  skill_gap_summary: string | null;
  created_at: string;
}

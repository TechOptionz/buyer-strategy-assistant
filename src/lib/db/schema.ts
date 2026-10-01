import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const organisations = pgTable("organisations", {
  id: id(),
  name: text("name").notNull(),
  settings: jsonb("settings").$type<OrgSettings>().notNull().default(sql`'{}'::jsonb`),
  createdAt: createdAt(),
});

export interface OrgSettings {
  brandName?: string;
  brandColour?: string;
  reportFooter?: string;
  freshnessDays?: Record<string, number>;
  retentionDays?: number;
  attribution?: string;
}

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: createdAt(),
});

export type Role = "org_admin" | "buyer_agent" | "reviewer";
export type Permission = "case_access_all" | "edit_profile" | "review" | "manage_org";

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    organisationId: uuid("organisation_id").notNull().references(() => organisations.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    role: text("role").$type<Role>().notNull(),
    permissions: jsonb("permissions").$type<Permission[]>().notNull().default(sql`'[]'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("membership_org_user").on(t.organisationId, t.userId)],
);

export type AssessmentStatus = "draft" | "needs_clarification" | "ready_for_review" | "reviewed";

export const assessments = pgTable(
  "assessments",
  {
    id: id(),
    organisationId: uuid("organisation_id").notNull().references(() => organisations.id),
    buyerDisplayName: text("buyer_display_name").notNull(),
    assignedAgentId: uuid("assigned_agent_id").notNull().references(() => users.id),
    reviewerId: uuid("reviewer_id").references(() => users.id),
    status: text("status").$type<AssessmentStatus>().notNull().default("draft"),
    entryMode: text("entry_mode").$type<"notes" | "guided">().notNull().default("guided"),
    /** Monotonic revision for optimistic concurrency on profile edits. */
    currentRevision: integer("current_revision").notNull().default(0),
    /** Area research and fit criteria chosen by the agent. */
    research: jsonb("research").$type<ResearchState>().notNull().default(sql`'{"areas":[]}'::jsonb`),
    idempotencyKey: text("idempotency_key"),
    isSeed: boolean("is_seed").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("assessment_org").on(t.organisationId),
    uniqueIndex("assessment_idem").on(t.organisationId, t.idempotencyKey),
  ],
);

export interface ResearchState {
  areas: { name: string; state?: string; postcode?: string; addedAt: string }[];
  propertyType?: string;
}

export type FactStatus = "proposed" | "confirmed" | "rejected" | "superseded";
export type FactValueState = "value" | "unknown" | "not_applicable" | "declined";
export type SourceType = "conversation" | "notes" | "structured_entry" | "document" | "agent_override";

/** Every proposed or confirmed value, with its evidence. The confirmed profile is derived from these. */
export const facts = pgTable(
  "facts",
  {
    id: id(),
    organisationId: uuid("organisation_id").notNull().references(() => organisations.id),
    assessmentId: uuid("assessment_id").notNull().references(() => assessments.id),
    fieldPath: text("field_path").notNull(),
    valueState: text("value_state").$type<FactValueState>().notNull().default("value"),
    value: jsonb("value").$type<unknown>(),
    unit: text("unit"),
    sourceType: text("source_type").$type<SourceType>().notNull(),
    sourceId: uuid("source_id"),
    evidenceText: text("evidence_text"),
    confidence: text("confidence").$type<"high" | "medium" | "low">(),
    status: text("status").$type<FactStatus>().notNull().default("proposed"),
    /** Revision at which the fact was confirmed (or proposed). */
    revision: integer("revision").notNull(),
    proposedBy: text("proposed_by").$type<"ai" | "rules" | "agent">().notNull(),
    confirmedById: uuid("confirmed_by_id").references(() => users.id),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("fact_assessment_path").on(t.assessmentId, t.fieldPath)],
);

export const profileRevisions = pgTable(
  "profile_revisions",
  {
    id: id(),
    organisationId: uuid("organisation_id").notNull().references(() => organisations.id),
    assessmentId: uuid("assessment_id").notNull().references(() => assessments.id),
    revision: integer("revision").notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    changedPaths: jsonb("changed_paths").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    changeSummary: text("change_summary"),
    createdById: uuid("created_by_id").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("profile_revision_unique").on(t.assessmentId, t.revision)],
);

export const turns = pgTable(
  "turns",
  {
    id: id(),
    organisationId: uuid("organisation_id").notNull().references(() => organisations.id),
    assessmentId: uuid("assessment_id").notNull().references(() => assessments.id),
    sequence: integer("sequence").notNull(),
    author: text("author").$type<"agent" | "buyer" | "assistant" | "system">().notNull(),
    kind: text("kind").$type<"answer" | "notes" | "question" | "message">().notNull(),
    text: text("text").notNull(),
    questionKey: text("question_key"),
    extractionStatus: text("extraction_status").$type<"none" | "pending" | "done" | "failed">().notNull().default("none"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("turn_idem").on(t.assessmentId, t.idempotencyKey),
    uniqueIndex("turn_seq").on(t.assessmentId, t.sequence),
  ],
);

export const marketEvidence = pgTable(
  "market_evidence",
  {
    id: id(),
    organisationId: uuid("organisation_id").notNull().references(() => organisations.id),
    assessmentId: uuid("assessment_id").notNull().references(() => assessments.id),
    provider: text("provider").notNull(),
    providerRecordRef: text("provider_record_ref"),
    area: text("area").notNull(),
    propertyType: text("property_type").notNull(),
    metric: text("metric").notNull(),
    valueNumeric: text("value_numeric").notNull(),
    unit: text("unit").notNull(),
    periodStart: text("period_start"),
    periodEnd: text("period_end").notNull(),
    sourceDescription: text("source_description").notNull(),
    observedAt: text("observed_at").notNull(),
    retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull().defaultNow(),
    quality: jsonb("quality").$type<Record<string, unknown>>(),
    isSample: boolean("is_sample").notNull().default(false),
    enteredById: uuid("entered_by_id").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("evidence_assessment").on(t.assessmentId)],
);

export const scenarios = pgTable(
  "scenarios",
  {
    id: id(),
    organisationId: uuid("organisation_id").notNull().references(() => organisations.id),
    assessmentId: uuid("assessment_id").notNull().references(() => assessments.id),
    profileRevision: integer("profile_revision").notNull(),
    parentScenarioId: uuid("parent_scenario_id"),
    name: text("name").notNull(),
    kind: text("kind").$type<"base" | "downside" | "upside" | "alternative">().notNull(),
    inputs: jsonb("inputs").$type<unknown>().notNull(),
    changes: jsonb("changes").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
    assumptionLabels: jsonb("assumption_labels").$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),
    evidenceIds: jsonb("evidence_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    calculationVersion: text("calculation_version").notNull(),
    inputHash: text("input_hash").notNull(),
    result: jsonb("result").$type<unknown>().notNull(),
    readiness: text("readiness").notNull(),
    missingFields: jsonb("missing_fields").$type<string[]>().notNull(),
    archived: boolean("archived").notNull().default(false),
    createdById: uuid("created_by_id").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("scenario_assessment").on(t.assessmentId)],
);

export type ReportStatus = "draft" | "ready_for_review" | "needs_changes" | "reviewed" | "superseded";

export const reports = pgTable(
  "reports",
  {
    id: id(),
    organisationId: uuid("organisation_id").notNull().references(() => organisations.id),
    assessmentId: uuid("assessment_id").notNull().references(() => assessments.id),
    version: integer("version").notNull(),
    /** Optimistic concurrency for edits/review. */
    rowVersion: integer("row_version").notNull().default(1),
    profileRevision: integer("profile_revision").notNull(),
    scenarioIds: jsonb("scenario_ids").$type<string[]>().notNull(),
    evidenceIds: jsonb("evidence_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    scope: jsonb("scope").$type<{ areaAssessment: boolean; purchaseBudget: boolean }>().notNull(),
    sections: jsonb("sections").$type<unknown>().notNull(),
    snapshot: jsonb("snapshot").$type<unknown>().notNull(),
    snapshotHash: text("snapshot_hash").notNull(),
    status: text("status").$type<ReportStatus>().notNull().default("draft"),
    changeSummary: text("change_summary"),
    reviewerId: uuid("reviewer_id").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewComment: text("review_comment"),
    narrativeSource: text("narrative_source").$type<"ai" | "template">().notNull(),
    createdById: uuid("created_by_id").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("report_version").on(t.assessmentId, t.version)],
);

export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    organisationId: uuid("organisation_id").notNull().references(() => organisations.id),
    assessmentId: uuid("assessment_id").references(() => assessments.id),
    type: text("type").$type<"extract_notes" | "export_pdf" | "market_lookup">().notNull(),
    status: text("status").$type<"queued" | "running" | "succeeded" | "failed" | "cancelled">().notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    result: jsonb("result").$type<Record<string, unknown>>(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdById: uuid("created_by_id").notNull().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("job_idem").on(t.organisationId, t.type, t.idempotencyKey)],
);

export const exports = pgTable("exports", {
  id: id(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id),
  reportId: uuid("report_id").notNull().references(() => reports.id),
  snapshotHash: text("snapshot_hash").notNull(),
  /** PDF bytes are regenerated deterministically from the frozen snapshot; size recorded for audit. */
  byteSize: bigint("byte_size", { mode: "number" }).notNull(),
  createdById: uuid("created_by_id").notNull().references(() => users.id),
  createdAt: createdAt(),
});

/** Audit log. Never stores buyer financial values. */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    organisationId: uuid("organisation_id").notNull().references(() => organisations.id),
    actorId: uuid("actor_id").references(() => users.id),
    action: text("action").notNull(),
    objectType: text("object_type").notNull(),
    objectId: text("object_id").notNull(),
    assessmentId: uuid("assessment_id"),
    correlationId: text("correlation_id").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("audit_org_assessment").on(t.organisationId, t.assessmentId)],
);

/** Operational AI call log: model, prompt version, outcome and timing. No financial content. */
export const aiCalls = pgTable("ai_calls", {
  id: id(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id),
  assessmentId: uuid("assessment_id"),
  mode: text("mode").$type<"intake" | "clarification" | "analysis" | "report">().notNull(),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  outcome: text("outcome").notNull(),
  latencyMs: integer("latency_ms").notNull(),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  createdAt: createdAt(),
});

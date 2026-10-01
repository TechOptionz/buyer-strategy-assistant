"use client";

import { useCallback, useContext, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { Alert, Badge, Button, EmptyState, Field, Select, SidePanel, TextInput } from "@/components/ui";
import { ROLE_LABEL } from "@/lib/format";
import { errorOf, SavedContext, TitleRow, TONE_TEXT, type AdminMember, type FormError, type Permission, type Role, type TextTone } from "./shared";

const ROLES: { value: Role; label: string }[] = [
  { value: "org_admin", label: ROLE_LABEL.org_admin },
  { value: "buyer_agent", label: ROLE_LABEL.buyer_agent },
  { value: "reviewer", label: ROLE_LABEL.reviewer },
];
const roleLabel = (r: string) => ROLE_LABEL[r] ?? r;

const PERMISSIONS: { value: Permission; label: string; help: string }[] = [
  { value: "case_access_all", label: "Access all cases", help: "Opens every case in the organisation, not only cases the user is assigned to as agent or reviewer." },
  { value: "edit_profile", label: "Edit buyer profiles", help: "Edit profiles, scenarios and evidence on any case the user can open, not only their own." },
  { value: "review", label: "Review", help: "Approve reports or return them with comments on any case the user can open." },
  { value: "manage_org", label: "Manage organisation", help: "Opens Administration: users, permissions, branding, providers, retention and health." },
];

/** Readable summary of extra permissions, e.g. "All cases · + Profile editing". */
function extraPermissions(m: AdminMember): { text: string; tone: TextTone } {
  const parts: string[] = [];
  if (m.permissions.includes("case_access_all")) parts.push("All cases");
  else if (m.role === "org_admin") parts.push(m.assignedCases > 0 ? "Assigned cases only" : "No case access (not granted)");
  if (m.permissions.includes("edit_profile")) parts.push("+ Profile editing");
  if (m.permissions.includes("review")) parts.push("+ Review");
  if (m.permissions.includes("manage_org") && m.role !== "org_admin") parts.push("+ Administration");
  if (!parts.length) return { text: "—", tone: "muted" };
  return { text: parts.join(" · "), tone: "ink" };
}

const GRID = "grid grid-cols-[minmax(0,1.4fr)_1.2fr_1.4fr_0.8fr_0.9fr_60px] gap-3 px-5";

export function UsersSection({ members, currentUserId, saved, title }: { members: AdminMember[]; currentUserId: string; saved: ReactNode; title: string }) {
  const [editing, setEditing] = useState<AdminMember | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const closeEdit = useCallback(() => setEditing(null), []);
  const closeCreate = useCallback(() => setCreating(false), []);

  const openCreate = () => {
    setNotice(null);
    setEditing(null);
    setCreating(true);
  };

  return (
    <>
      <TitleRow
        title={title}
        saved={saved}
        action={
          <Button variant="primary" onClick={openCreate} className="hidden md:inline-flex" aria-haspopup="dialog">
            Add user
          </Button>
        }
      />
      <Button variant="primary" onClick={openCreate} className="h-12 w-full text-base md:hidden" aria-haspopup="dialog">
        Add user
      </Button>

      {notice && (
        <Alert
          tone="ok"
          title="Saved"
          action={
            <Button size="sm" variant="ghost" onClick={() => setNotice(null)}>
              Dismiss
            </Button>
          }
        >
          {notice}
        </Alert>
      )}

      {members.length === 0 ? (
        <EmptyState title="No users yet">Add a user with a temporary password to give them access.</EmptyState>
      ) : (
        <section aria-label="Organisation users" className="overflow-hidden rounded-lg border border-line bg-surface">
          {/* Desktop table */}
          <div role="table" aria-label="Organisation users" className="hidden md:block">
            <div role="row" className={`${GRID} h-8 items-center border-b border-line bg-subtle text-xs font-medium text-muted`}>
              <span role="columnheader">User</span>
              <span role="columnheader">Role</span>
              <span role="columnheader">Extra permissions</span>
              <span role="columnheader" className="text-right" title="Cases assigned as agent or reviewer">
                Cases
              </span>
              <span role="columnheader">Status</span>
              <span role="columnheader">
                <span className="sr-only">Actions</span>
              </span>
            </div>
            {members.map((m) => {
              const extra = extraPermissions(m);
              return (
                <div key={m.userId} role="row" className={`${GRID} min-h-12 items-center border-b border-line-soft py-1.5 text-[13px] last:border-b-0`}>
                  <div role="rowheader" className="flex min-w-0 flex-col">
                    <span className="flex items-center gap-2 font-medium text-ink">
                      <span className="truncate">{m.name}</span>
                      {m.userId === currentUserId && (
                        <Badge tone="info" icon={null}>
                          You
                        </Badge>
                      )}
                    </span>
                    <span className="truncate text-xs text-muted">{m.email}</span>
                  </div>
                  <span role="cell" className="text-ink-2">
                    {roleLabel(m.role)}
                  </span>
                  <span role="cell" className={`text-xs ${TONE_TEXT[extra.tone]}`}>
                    {extra.text}
                  </span>
                  <span role="cell" className={`num text-right ${m.assignedCases ? "text-ink" : "text-muted"}`}>
                    {m.assignedCases.toLocaleString("en-AU")}
                  </span>
                  <span role="cell" className="text-xs font-medium text-ok">
                    ✓ Active
                  </span>
                  <span role="cell" className="text-right">
                    <button
                      type="button"
                      onClick={() => {
                        setNotice(null);
                        setCreating(false);
                        setEditing(m);
                      }}
                      aria-label={`Edit role and permissions for ${m.name}`}
                      className="text-xs text-accent hover:text-accent-hover hover:underline"
                    >
                      Edit
                    </button>
                  </span>
                </div>
              );
            })}
          </div>

          {/* Mobile stacked rows */}
          <ul className="md:hidden">
            {members.map((m) => {
              const extra = extraPermissions(m);
              return (
                <li key={m.userId} className="border-b border-line-soft last:border-b-0">
                  <button
                    type="button"
                    onClick={() => {
                      setNotice(null);
                      setCreating(false);
                      setEditing(m);
                    }}
                    aria-label={`Edit role and permissions for ${m.name}`}
                    className="flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-hover"
                  >
                    <span className="flex w-full items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-ink">
                        {m.name}
                        {m.userId === currentUserId && <span className="ml-2 text-xs font-medium text-accent">You</span>}
                      </span>
                      <span className="text-xs font-medium text-ok">✓ Active</span>
                    </span>
                    <span className="text-[13px] text-ink-secondary">
                      {roleLabel(m.role)} · {m.assignedCases} {m.assignedCases === 1 ? "case" : "cases"}
                    </span>
                    <span className={`text-xs ${TONE_TEXT[extra.tone]}`}>{extra.text}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <RoleMatrix />

      <SidePanel
        open={creating}
        onClose={closeCreate}
        label="Add user"
        footer={
          <>
            <Button type="submit" form="create-user" variant="primary">
              Create user
            </Button>
            <Button variant="ghost" onClick={closeCreate}>
              Cancel
            </Button>
          </>
        }
      >
        {creating && (
          <CreateUserForm
            onCreated={(name) => {
              setCreating(false);
              setNotice(`User ${name} created with the temporary password you set. Share it only through an approved secure channel and ask them to change it after first sign-in.`);
            }}
          />
        )}
      </SidePanel>

      <SidePanel
        open={!!editing}
        onClose={closeEdit}
        label="Edit user"
        footer={
          <>
            <Button type="submit" form="edit-user" variant="primary">
              Save changes
            </Button>
            <Button variant="ghost" onClick={closeEdit}>
              Cancel
            </Button>
          </>
        }
      >
        {editing && (
          <EditMemberForm
            key={editing.userId}
            member={editing}
            isSelf={editing.userId === currentUserId}
            onSaved={() => {
              setNotice(`Role and permissions updated for ${editing.name}.`);
              setEditing(null);
            }}
          />
        )}
      </SidePanel>
    </>
  );
}

/* ------------------------------- Role permissions ------------------------------- */

type Cell = { text: string; tone: TextTone };
const Y: Cell = { text: "✓ Yes", tone: "ok" };
const N: Cell = { text: "— No", tone: "muted" };
const G: Cell = { text: "◐ If granted", tone: "est" };
const AS: Cell = { text: "✓ Assigned cases", tone: "ok" };
const AG: Cell = { text: "✓ As assigned agent", tone: "ok" };

/**
 * Mirrors src/lib/access (canView / canEdit / canReview / requireAdmin) and the services that call
 * them. Case access follows assignment and explicit permissions; role alone grants no case data.
 */
const MATRIX: { cap: string; how: string; cells: [Cell, Cell, Cell] }[] = [
  { cap: "Manage users, branding, providers, retention; view health", how: "Administrator role, or manage_org permission", cells: [Y, G, G] },
  { cap: "Create cases", how: "Created cases are assigned to their creator", cells: [Y, Y, Y] },
  { cap: "Assign new cases to other agents", how: "Administrator role only", cells: [Y, N, N] },
  { cap: "Open case data", how: "Assigned as the case agent or reviewer", cells: [AS, AS, AS] },
  { cap: "Open every case in the organisation", how: "case_access_all permission", cells: [G, G, G] },
  { cap: "Edit profile, scenarios, evidence and report drafts", how: "Assigned agent, or edit_profile on a case they can open", cells: [AG, AG, AG] },
  { cap: "Edit cases they are not the agent on", how: "edit_profile permission", cells: [G, G, G] },
  { cap: "Approve reports · return with comments", how: "Assigned agent or reviewer, or review permission", cells: [AS, AS, AS] },
  { cap: "Export report PDF", how: "Anyone who can open the case", cells: [AS, AS, AS] },
];

function RoleMatrix() {
  const grid = "grid grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))] gap-3 px-5";
  return (
    <section aria-labelledby="role-matrix-title" className="overflow-hidden rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line px-4 py-3.5 md:px-5">
        <h2 id="role-matrix-title" className="flex-1 text-base font-semibold text-ink">
          Role permissions
        </h2>
        <span className="text-xs text-muted">Enforced on every server request — hiding a button is not access control</span>
      </div>
      <div className="overflow-x-auto">
        <div role="table" aria-labelledby="role-matrix-title" className="min-w-[680px]">
          <div role="row" className={`${grid} h-8 items-center border-b border-line bg-subtle text-xs font-medium text-muted`}>
            <span role="columnheader">Capability</span>
            <span role="columnheader" className="text-center">
              Org administrator
            </span>
            <span role="columnheader" className="text-center">
              Buyer agent
            </span>
            <span role="columnheader" className="text-center">
              Reviewer
            </span>
          </div>
          {MATRIX.map((r) => (
            <div key={r.cap} role="row" className={`${grid} min-h-[38px] items-center border-b border-line-soft py-1.5 text-[13px]`}>
              <span role="rowheader" className="flex flex-col">
                <span className="text-ink">{r.cap}</span>
                <span className="text-xs text-muted">{r.how}</span>
              </span>
              {r.cells.map((c, i) => (
                <span key={i} role="cell" className={`text-center text-xs ${TONE_TEXT[c.tone]}`}>
                  {c.text}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
      <p className="px-4 py-3 text-xs text-muted md:px-5">
        Roles describe a user&rsquo;s job. Case access comes from assignment and the extra permissions above — an administrator does not see case data unless assigned or granted all cases.
      </p>
    </section>
  );
}

/* ------------------------------- Forms ------------------------------- */

function PermissionCheckboxes({ idPrefix, value, onChange }: { idPrefix: string; value: Permission[]; onChange: (p: Permission[]) => void }) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1.5 text-[13px] font-medium text-ink-secondary">Extra permissions</legend>
      {PERMISSIONS.map((p) => {
        const id = `${idPrefix}-${p.value}`;
        return (
          <div key={p.value} className="flex items-start gap-2.5">
            <input
              id={id}
              type="checkbox"
              className="mt-0.5 h-4 w-4 flex-none accent-accent"
              checked={value.includes(p.value)}
              aria-describedby={`${id}-help`}
              onChange={(e) => onChange(e.target.checked ? [...value, p.value] : value.filter((x) => x !== p.value))}
            />
            <div className="flex flex-col gap-0.5">
              <label htmlFor={id} className="text-sm text-ink">
                {p.label} <code className="font-mono text-xs text-muted">{p.value}</code>
              </label>
              <p id={`${id}-help`} className="text-xs text-muted">
                {p.help}
              </p>
            </div>
          </div>
        );
      })}
    </fieldset>
  );
}

function EditMemberForm({ member, isSelf, onSaved }: { member: AdminMember; isSelf: boolean; onSaved: () => void }) {
  const router = useRouter();
  const markSaved = useContext(SavedContext);
  const [role, setRole] = useState<Role>(member.role);
  const [permissions, setPermissions] = useState<Permission[]>(member.permissions);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<FormError | null>(null);
  const prefix = `edit-${member.userId}`;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setErr(null);
    try {
      await api("/api/admin/users", { method: "POST", body: { action: "update", userId: member.userId, role, permissions } });
      markSaved(new Date());
      onSaved();
      router.refresh();
    } catch (e2) {
      setErr(errorOf(e2));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form id="edit-user" onSubmit={submit} className="flex flex-col gap-5 px-4 py-4 md:px-6" aria-label={`Edit ${member.name}`} aria-busy={saving}>
      <div className="flex flex-col">
        <h2 className="text-lg font-semibold text-ink">{member.name}</h2>
        <span className="text-[13px] text-muted">{member.email}</span>
      </div>
      {err && (
        <Alert tone="bad" title="Could not save changes">
          {err.message}
        </Alert>
      )}
      <Field label="Role" htmlFor={`${prefix}-role`} error={err?.fieldErrors.role} hint={isSelf ? "You cannot remove your own administrator role." : undefined}>
        <Select id={`${prefix}-role`} value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </Select>
      </Field>
      <div>
        <PermissionCheckboxes idPrefix={prefix} value={permissions} onChange={setPermissions} />
        {err?.fieldErrors.permissions && (
          <p role="alert" className="mt-1 text-xs text-bad">
            <span aria-hidden="true">⚠︎ </span>
            {err.fieldErrors.permissions}
          </p>
        )}
      </div>
      {saving && <p className="text-xs text-muted">Saving…</p>}
    </form>
  );
}

function CreateUserForm({ onCreated }: { onCreated: (name: string) => void }) {
  const router = useRouter();
  const markSaved = useContext(SavedContext);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("buyer_agent");
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<FormError | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setErr(null);
    if (password.length < 12) {
      setErr({ message: "Please fix the highlighted fields.", fieldErrors: { temporaryPassword: "Must be at least 12 characters" } });
      return;
    }
    setSaving(true);
    try {
      await api("/api/admin/users", { method: "POST", body: { action: "create", name: name.trim(), email: email.trim(), role, permissions, temporaryPassword: password } });
      setPassword("");
      markSaved(new Date());
      onCreated(name.trim());
      router.refresh();
    } catch (e2) {
      setErr(errorOf(e2));
    } finally {
      setSaving(false);
    }
  }

  const fe = err?.fieldErrors ?? {};
  return (
    <form id="create-user" onSubmit={submit} className="flex flex-col gap-4 px-4 py-4 md:px-6" aria-label="Add user" aria-busy={saving} noValidate>
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-ink">Add user</h2>
        <p className="text-[13px] text-ink-secondary">The user signs in with the email and a temporary password you set here. No invitation email is sent.</p>
      </div>
      {err && (
        <Alert tone="bad" title="Could not create user">
          {err.message}
        </Alert>
      )}
      <Field label="Name" htmlFor="new-name" error={fe.name}>
        <TextInput id="new-name" required autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} invalid={!!fe.name} maxLength={120} />
      </Field>
      <Field label="Email" htmlFor="new-email" error={fe.email}>
        <TextInput id="new-email" type="email" required autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} invalid={!!fe.email} maxLength={200} />
      </Field>
      <Field label="Role" htmlFor="new-role" error={fe.role}>
        <Select id="new-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Temporary password" htmlFor="new-password" error={fe.temporaryPassword} hint="At least 12 characters. Share it only through an approved secure channel; the user should change it after first sign-in.">
        <TextInput
          id="new-password"
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          invalid={!!fe.temporaryPassword}
          aria-describedby={fe.temporaryPassword ? "new-password-error" : "new-password-hint"}
        />
      </Field>
      <PermissionCheckboxes idPrefix="new-perm" value={permissions} onChange={setPermissions} />
      {fe.permissions && (
        <p role="alert" className="text-xs text-bad">
          <span aria-hidden="true">⚠︎ </span>
          {fe.permissions}
        </p>
      )}
      {saving && <p className="text-xs text-muted">Creating…</p>}
    </form>
  );
}

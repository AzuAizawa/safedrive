import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import type {
  AdminPermissionCatalogRow,
  AdminPermissionTemplateRow,
  Profile,
} from "@/types/database";

type AdminRow = Pick<
  Profile,
  "id" | "email" | "full_name" | "admin_disabled_at" | "created_at"
> & { keys: string[] };

export default function AdminAdminsPage() {
  const { user, session } = useAuth();
  const [catalog, setCatalog] = useState<AdminPermissionCatalogRow[]>([]);
  const [templates, setTemplates] = useState<AdminPermissionTemplateRow[]>([]);
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [busyAdminId, setBusyAdminId] = useState<string | null>(null);
  // Per-admin working copy of the checklist. An entry only exists once the
  // super admin has ticked something for that admin (a pending, unsaved edit).
  const [draftKeys, setDraftKeys] = useState<Record<string, string[]>>({});
  const [deleteTarget, setDeleteTarget] = useState<AdminRow | null>(null);

  const [form, setForm] = useState({
    email: "",
    fullName: "",
    template: "general_admin",
    keys: [] as string[],
  });
  const [invalidFields, setInvalidFields] = useState<{
    email?: boolean;
    fullName?: boolean;
  }>({});

  const load = useCallback(async () => {
    setLoading(true);
    const [catalogResult, templateResult, adminResult, grantResult] =
      await Promise.all([
        supabase
          .from("admin_permission_catalog")
          .select("*")
          .order("sort_order"),
        supabase
          .from("admin_permission_templates")
          .select("*")
          .order("sort_order"),
        supabase
          .from("profiles")
          .select("id, email, full_name, admin_disabled_at, created_at")
          .eq("role", "admin")
          .is("deleted_at", null)
          .order("created_at", { ascending: false }),
        supabase.from("admin_permissions").select("admin_id, permission_key"),
      ]);

    const error =
      catalogResult.error ||
      templateResult.error ||
      adminResult.error ||
      grantResult.error;
    if (error) {
      toast.error("Admin roster could not be loaded", {
        description: error.message,
      });
      setLoading(false);
      return;
    }

    const grantsByAdmin = new Map<string, string[]>();
    for (const grant of grantResult.data ?? []) {
      const list = grantsByAdmin.get(grant.admin_id) ?? [];
      list.push(grant.permission_key);
      grantsByAdmin.set(grant.admin_id, list);
    }

    setCatalog(catalogResult.data ?? []);
    setTemplates(templateResult.data ?? []);
    setAdmins(
      (adminResult.data ?? []).map((row) => ({
        ...row,
        keys: grantsByAdmin.get(row.id) ?? [],
      })),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const templateKeys = useCallback(
    (templateId: string) =>
      templates.find((item) => item.id === templateId)?.permission_keys ?? [],
    [templates],
  );

  // Pre-fill the checklist from the default template once the templates load,
  // but only while the form is still untouched (so a reload after creating an
  // admin re-applies it, and a manual edit is never overwritten).
  useEffect(() => {
    if (templates.length === 0) return;
    setForm((current) =>
      current.email === "" &&
      current.fullName === "" &&
      current.keys.length === 0 &&
      current.template !== "custom"
        ? { ...current, keys: [...templateKeys(current.template)] }
        : current,
    );
  }, [templates, templateKeys]);

  // Keep the create-form checklist in sync when a template is picked.
  const applyTemplate = (templateId: string) => {
    setForm((current) => ({
      ...current,
      template: templateId,
      keys:
        templateId === "custom"
          ? current.keys
          : [...templateKeys(templateId)],
    }));
  };

  const toggleFormKey = (key: string) =>
    setForm((current) => ({
      ...current,
      template: "custom",
      keys: current.keys.includes(key)
        ? current.keys.filter((item) => item !== key)
        : [...current.keys, key],
    }));

  const createAdmin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (creating) return;
    if (!session?.access_token) {
      toast.error("Your session expired", {
        description: "Sign in again, then create the admin.",
      });
      return;
    }
    if (form.keys.length === 0) {
      toast.error("Pick at least one permission", {
        description: "An admin with no permissions cannot do anything.",
      });
      return;
    }
    setCreating(true);
    try {
      const response = await fetch("/api/admin-create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          email: form.email.trim(),
          fullName: form.fullName.trim(),
          permissionKeys: form.keys,
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Admin creation failed");
      toast.success("Invite sent", {
        description: `${form.email.trim()} can now set a password and enrol MFA.`,
      });
      setForm({ email: "", fullName: "", template: "general_admin", keys: [] });
      setInvalidFields({});
      await load();
    } catch (error) {
      toast.error("Admin was not created", {
        description: error instanceof Error ? error.message : "Please try again",
      });
    } finally {
      setCreating(false);
    }
  };

  const workingKeys = (admin: AdminRow) => draftKeys[admin.id] ?? admin.keys;

  const isDirty = (admin: AdminRow) => {
    const draft = draftKeys[admin.id];
    if (!draft) return false;
    const saved = admin.keys;
    return (
      draft.length !== saved.length ||
      draft.some((key) => !saved.includes(key))
    );
  };

  // Local only - the checklist changes are not written until "Save changes".
  const toggleDraftKey = (admin: AdminRow, key: string) => {
    setDraftKeys((current) => {
      const base = current[admin.id] ?? admin.keys;
      const next = base.includes(key)
        ? base.filter((item) => item !== key)
        : [...base, key];
      return { ...current, [admin.id]: next };
    });
  };

  const discardDraft = (adminId: string) =>
    setDraftKeys((current) => {
      const { [adminId]: _removed, ...rest } = current;
      return rest;
    });

  const savePermissions = async (admin: AdminRow) => {
    if (!user?.id || busyAdminId) return;
    const draft = draftKeys[admin.id];
    if (!draft) return;
    const added = draft.filter((key) => !admin.keys.includes(key));
    const removed = admin.keys.filter((key) => !draft.includes(key));
    if (added.length === 0 && removed.length === 0) {
      discardDraft(admin.id);
      return;
    }

    setBusyAdminId(admin.id);
    try {
      if (added.length > 0) {
        const { error } = await supabase.from("admin_permissions").insert(
          added.map((key) => ({
            admin_id: admin.id,
            permission_key: key,
            granted_by: user.id,
          })),
        );
        if (error) throw error;
      }
      if (removed.length > 0) {
        const { error } = await supabase
          .from("admin_permissions")
          .delete()
          .eq("admin_id", admin.id)
          .in("permission_key", removed);
        if (error) throw error;
      }

      // One granular audit row per change, with a name snapshot so the entry
      // still reads clearly if this admin is later deleted.
      const auditRows = [
        ...added.map((key) => ({ granted: true, key })),
        ...removed.map((key) => ({ granted: false, key })),
      ].map((change) => ({
        user_id: user.id,
        action: change.granted
          ? "admin_permission_granted"
          : "admin_permission_revoked",
        entity_type: "profile",
        entity_id: admin.id,
        details: {
          permission_key: change.key,
          admin_email: admin.email,
          admin_name: admin.full_name,
        },
      }));
      await supabase.from("audit_log").insert(auditRows);

      setAdmins((current) =>
        current.map((row) =>
          row.id === admin.id ? { ...row, keys: [...draft] } : row,
        ),
      );
      discardDraft(admin.id);
      toast.success("Permissions updated", {
        description: `${added.length} added, ${removed.length} removed.`,
      });
    } catch (error) {
      toast.error("Permissions were not saved", {
        description: error instanceof Error ? error.message : "Please try again",
      });
    } finally {
      setBusyAdminId(null);
    }
  };

  const deleteAdmin = async (admin: AdminRow) => {
    if (!session?.access_token || busyAdminId) return;
    setBusyAdminId(admin.id);
    try {
      const response = await fetch("/api/admin-delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ targetUserId: admin.id }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Delete failed");
      setAdmins((current) => current.filter((row) => row.id !== admin.id));
      discardDraft(admin.id);
      toast.success("Admin account deleted", {
        description: `${admin.email} can no longer sign in and the email is free to reuse.`,
      });
    } catch (error) {
      toast.error("Admin was not deleted", {
        description: error instanceof Error ? error.message : "Please try again",
      });
    } finally {
      setBusyAdminId(null);
      setDeleteTarget(null);
    }
  };

  const resendInvite = async (admin: AdminRow) => {
    if (busyAdminId) return;
    setBusyAdminId(admin.id);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(admin.email, {
        redirectTo: `${window.location.origin}/update-password`,
      });
      if (error) throw error;
      toast.success("Set-password email sent", {
        description: `${admin.email} can use it to set a password and enrol MFA.`,
      });
    } catch (error) {
      toast.error("Email was not sent", {
        description: error instanceof Error ? error.message : "Please try again",
      });
    } finally {
      setBusyAdminId(null);
    }
  };

  const toggleDisabled = async (admin: AdminRow) => {
    if (!user?.id || busyAdminId) return;
    const disabling = !admin.admin_disabled_at;
    const nextValue = disabling ? new Date().toISOString() : null;
    setBusyAdminId(admin.id);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ admin_disabled_at: nextValue })
        .eq("id", admin.id);
      if (error) throw error;
      await supabase.from("audit_log").insert({
        user_id: user.id,
        action: disabling ? "admin_account_disabled" : "admin_account_enabled",
        entity_type: "profile",
        entity_id: admin.id,
        details: { admin_email: admin.email, admin_name: admin.full_name },
      });
      setAdmins((current) =>
        current.map((row) =>
          row.id === admin.id ? { ...row, admin_disabled_at: nextValue } : row,
        ),
      );
      toast.success(disabling ? "Admin disabled" : "Admin re-enabled");
    } catch (error) {
      toast.error("Account status was not changed", {
        description: error instanceof Error ? error.message : "Please try again",
      });
    } finally {
      setBusyAdminId(null);
    }
  };

  const catalogByKey = useMemo(
    () => new Map(catalog.map((item) => [item.key, item])),
    [catalog],
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold">
          <ShieldCheck className="h-7 w-7" /> Admin Accounts
        </h1>
        <p className="mt-1 max-w-3xl text-muted-foreground">
          Create staff accounts and control exactly which jobs each one can do.
          A super admin is never created here - that is done directly in the
          database. Every change is written to the audit trail, and the server
          enforces each permission regardless of what the screen shows.
        </p>
      </div>

      <form
        onSubmit={createAdmin}
        className="grid gap-4 rounded-xl border bg-card p-5 md:grid-cols-2"
      >
        <h2 className="flex items-center gap-2 text-lg font-semibold md:col-span-2">
          <UserPlus className="h-5 w-5" /> New admin
        </h2>
        <label className="space-y-2">
          <Label>Email</Label>
          <Input
            type="email"
            value={form.email}
            onChange={(event) => {
              setForm({ ...form, email: event.target.value });
              setInvalidFields((current) => ({ ...current, email: false }));
            }}
            onInvalid={() =>
              setInvalidFields((current) => ({ ...current, email: true }))
            }
            aria-invalid={invalidFields.email || undefined}
            required
          />
          {invalidFields.email ? (
            <p className="text-xs font-medium text-destructive">
              Enter the admin&apos;s email address.
            </p>
          ) : null}
        </label>
        <label className="space-y-2">
          <Label>Full name</Label>
          <Input
            value={form.fullName}
            onChange={(event) => {
              setForm({ ...form, fullName: event.target.value });
              setInvalidFields((current) => ({ ...current, fullName: false }));
            }}
            onInvalid={() =>
              setInvalidFields((current) => ({ ...current, fullName: true }))
            }
            aria-invalid={invalidFields.fullName || undefined}
            required
          />
          {invalidFields.fullName ? (
            <p className="text-xs font-medium text-destructive">
              Enter the admin&apos;s full name.
            </p>
          ) : null}
        </label>
        <label className="space-y-2 md:col-span-2">
          <Label>Start from a template</Label>
          <select
            className="h-10 w-full rounded-md border bg-background px-3"
            value={form.template}
            onChange={(event) => applyTemplate(event.target.value)}
          >
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.label}
              </option>
            ))}
            <option value="custom">Custom</option>
          </select>
        </label>
        <fieldset className="space-y-2 md:col-span-2">
          <Label>Permissions</Label>
          <div className="grid gap-2 sm:grid-cols-2">
            {catalog.map((permission) => (
              <label
                key={permission.key}
                className="flex items-start gap-2 rounded-lg border bg-background/60 p-3 text-sm"
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={form.keys.includes(permission.key)}
                  onChange={() => toggleFormKey(permission.key)}
                />
                <span>
                  <span className="font-medium">{permission.job_label}</span>
                  {permission.description ? (
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {permission.description}
                    </span>
                  ) : null}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <Button type="submit" className="md:col-span-2" disabled={creating}>
          {creating ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Plus className="mr-2 h-4 w-4" />
          )}
          Send invite
        </Button>
      </form>

      {loading ? (
        <Loader2 className="h-6 w-6 animate-spin" />
      ) : admins.length === 0 ? (
        <p className="rounded-xl border bg-card p-8 text-center text-muted-foreground">
          No admin accounts yet.
        </p>
      ) : (
        <div className="space-y-4">
          {admins.map((admin) => (
            <article key={admin.id} className="rounded-xl border bg-card p-4">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                <div>
                  <h2 className="font-semibold">
                    {admin.full_name || "(no name)"}
                    {admin.admin_disabled_at ? (
                      <span className="ml-2 rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-500">
                        Disabled
                      </span>
                    ) : null}
                  </h2>
                  <p className="text-sm text-muted-foreground">{admin.email}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {admin.keys.length} of {catalog.length} permissions · added{" "}
                    {new Date(admin.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busyAdminId === admin.id}
                    onClick={() => void resendInvite(admin)}
                  >
                    Resend invite
                  </Button>
                  <Button
                    size="sm"
                    variant={admin.admin_disabled_at ? "default" : "outline"}
                    disabled={busyAdminId === admin.id}
                    onClick={() => void toggleDisabled(admin)}
                  >
                    {admin.admin_disabled_at ? "Re-enable" : "Disable"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    disabled={busyAdminId === admin.id}
                    onClick={() => setDeleteTarget(admin)}
                  >
                    <Trash2 className="mr-1.5 h-4 w-4" />
                    Delete
                  </Button>
                </div>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {catalog.map((permission) => {
                  const checked = workingKeys(admin).includes(permission.key);
                  return (
                    <label
                      key={permission.key}
                      className={`flex items-center gap-2 rounded-lg border p-2.5 text-sm ${
                        checked ? "border-primary/40 bg-primary/5" : "bg-background/60"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={busyAdminId === admin.id || !!admin.admin_disabled_at}
                        onChange={() => toggleDraftKey(admin, permission.key)}
                      />
                      <span className="font-medium">
                        {catalogByKey.get(permission.key)?.job_label ?? permission.key}
                      </span>
                    </label>
                  );
                })}
              </div>

              {isDirty(admin) ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
                  <span className="text-sm font-medium text-amber-700 dark:text-amber-400">
                    Unsaved permission changes
                  </span>
                  <span className="flex-1" />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyAdminId === admin.id}
                    onClick={() => discardDraft(admin.id)}
                  >
                    Discard
                  </Button>
                  <Button
                    size="sm"
                    disabled={busyAdminId === admin.id}
                    onClick={() => void savePermissions(admin)}
                  >
                    {busyAdminId === admin.id ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    Save changes
                  </Button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete this admin account?"
        description={
          deleteTarget
            ? `${deleteTarget.full_name || deleteTarget.email} will be permanently removed - they can no longer sign in and the email (${deleteTarget.email}) becomes free to reuse. Their past actions stay in the audit trail as "Former staff". Use Disable instead if they might return.`
            : ""
        }
        confirmText="Delete account"
        destructive
        isLoading={busyAdminId !== null && busyAdminId === deleteTarget?.id}
        onConfirm={() => {
          if (deleteTarget) void deleteAdmin(deleteTarget);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

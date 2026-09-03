import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, ShieldCheck, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

  const [form, setForm] = useState({
    email: "",
    fullName: "",
    template: "general_admin",
    keys: [] as string[],
  });

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

  // Keep the create-form checklist in sync when a template is picked.
  const applyTemplate = (templateId: string) => {
    const template = templates.find((item) => item.id === templateId);
    setForm((current) => ({
      ...current,
      template: templateId,
      keys: template ? [...template.permission_keys] : current.keys,
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
    if (!session?.access_token || creating) return;
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
      await load();
    } catch (error) {
      toast.error("Admin was not created", {
        description: error instanceof Error ? error.message : "Please try again",
      });
    } finally {
      setCreating(false);
    }
  };

  const toggleAdminKey = async (admin: AdminRow, key: string) => {
    if (!user?.id || busyAdminId) return;
    const granting = !admin.keys.includes(key);
    setBusyAdminId(admin.id);
    try {
      if (granting) {
        const { error } = await supabase
          .from("admin_permissions")
          .insert({ admin_id: admin.id, permission_key: key, granted_by: user.id });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("admin_permissions")
          .delete()
          .eq("admin_id", admin.id)
          .eq("permission_key", key);
        if (error) throw error;
      }
      await supabase.from("audit_log").insert({
        user_id: user.id,
        action: granting ? "admin_permission_granted" : "admin_permission_revoked",
        entity_type: "profile",
        entity_id: admin.id,
        details: { permission_key: key },
      });
      await load();
    } catch (error) {
      toast.error("Permission was not changed", {
        description: error instanceof Error ? error.message : "Please try again",
      });
    } finally {
      setBusyAdminId(null);
    }
  };

  const toggleDisabled = async (admin: AdminRow) => {
    if (!user?.id || busyAdminId) return;
    const disabling = !admin.admin_disabled_at;
    setBusyAdminId(admin.id);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ admin_disabled_at: disabling ? new Date().toISOString() : null })
        .eq("id", admin.id);
      if (error) throw error;
      await supabase.from("audit_log").insert({
        user_id: user.id,
        action: disabling ? "admin_account_disabled" : "admin_account_enabled",
        entity_type: "profile",
        entity_id: admin.id,
        details: {},
      });
      await load();
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
            onChange={(event) => setForm({ ...form, email: event.target.value })}
            required
          />
        </label>
        <label className="space-y-2">
          <Label>Full name</Label>
          <Input
            value={form.fullName}
            onChange={(event) =>
              setForm({ ...form, fullName: event.target.value })
            }
            required
          />
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
        <Button className="md:col-span-2" disabled={creating}>
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
                <Button
                  size="sm"
                  variant={admin.admin_disabled_at ? "default" : "outline"}
                  disabled={busyAdminId === admin.id}
                  onClick={() => void toggleDisabled(admin)}
                >
                  {admin.admin_disabled_at ? "Re-enable" : "Disable"}
                </Button>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {catalog.map((permission) => {
                  const granted = admin.keys.includes(permission.key);
                  return (
                    <label
                      key={permission.key}
                      className={`flex items-center gap-2 rounded-lg border p-2.5 text-sm ${
                        granted ? "border-primary/40 bg-primary/5" : "bg-background/60"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={granted}
                        disabled={busyAdminId === admin.id || !!admin.admin_disabled_at}
                        onChange={() => void toggleAdminKey(admin, permission.key)}
                      />
                      <span className="font-medium">
                        {catalogByKey.get(permission.key)?.job_label ?? permission.key}
                      </span>
                    </label>
                  );
                })}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock,
  Info,
  Loader2,
  Mail,
  Settings2,
  ThumbsDown,
  ThumbsUp,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase";
import {
  DEFAULT_CONTACT_EMAIL,
  DEFAULT_USER_VERIFICATION_ETA,
  DEFAULT_VEHICLE_VERIFICATION_ETA,
} from "@/lib/platformSettings";

const isEmailShaped = (value: string) =>
  /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim());

type SettingsRow = {
  commission_rate: number;
  payment_processing_fee_rate: number;
  payment_processing_fixed_centavos: number;
  downpayment_rate: number;
  refund_full_hours: number;
  refund_late_renter_percent: number;
  arrival_checkin_lead_hours: number;
  deposit_claim_window_hours: number;
  lister_completion_timeout_hours: number;
};

type ChangeRequest = {
  id: string;
  proposed_by: string;
  changes: Record<string, number>;
  snapshot: Record<string, number>;
  reason: string | null;
  status: string;
  created_at: string;
  resolved_at: string | null;
  expires_at: string;
};

type VoteRow = { request_id: string; voter_id: string; vote: "approve" | "reject" };

// key -> { label, unit, toDisplay(stored), fromDisplay(input) -> stored | null }
const FIELDS: Record<
  keyof SettingsRow,
  {
    label: string;
    hint: string;
    unit: "%" | "PHP" | "hours";
    toDisplay: (stored: number) => string;
    fromDisplay: (input: string) => number | null;
    formatStored: (stored: number) => string;
  }
> = {
  commission_rate: {
    label: "SafeDrive commission",
    hint: "Share of the booking kept as platform commission (0-100%).",
    unit: "%",
    toDisplay: (s) => String(Math.round(s * 10000) / 100),
    fromDisplay: (i) => {
      const n = Number(i);
      return Number.isFinite(n) && n >= 0 && n <= 100 ? n / 100 : null;
    },
    formatStored: (s) => `${Math.round(s * 10000) / 100}%`,
  },
  payment_processing_fee_rate: {
    label: "Provider percentage passed to renter",
    hint: "Only for a confirmed PayMongo rate (0-25%). Keep 0 unless verified.",
    unit: "%",
    toDisplay: (s) => String(Math.round(s * 10000) / 100),
    fromDisplay: (i) => {
      const n = Number(i);
      return Number.isFinite(n) && n >= 0 && n <= 25 ? n / 100 : null;
    },
    formatStored: (s) => `${Math.round(s * 10000) / 100}%`,
  },
  payment_processing_fixed_centavos: {
    label: "Provider fixed charge to renter",
    hint: "Fixed peso charge per transaction. Keep 0 unless verified.",
    unit: "PHP",
    toDisplay: (s) => String(Math.round(s) / 100),
    fromDisplay: (i) => {
      const n = Math.round(Number(i) * 100);
      return Number.isFinite(n) && n >= 0 && n <= 100000 ? n : null;
    },
    formatStored: (s) => `PHP ${(Math.round(s) / 100).toLocaleString()}`,
  },
  downpayment_rate: {
    label: "Reservation downpayment",
    hint: "Share due to reserve a booking (20-100%). 100% means full payment.",
    unit: "%",
    toDisplay: (s) => String(Math.round(s * 10000) / 100),
    fromDisplay: (i) => {
      const n = Number(i);
      return Number.isFinite(n) && n >= 20 && n <= 100 ? n / 100 : null;
    },
    formatStored: (s) => `${Math.round(s * 10000) / 100}%`,
  },
  refund_full_hours: {
    label: "Full-refund window before pickup",
    hint: "Cancel this many hours before pickup for a full refund (0-720).",
    unit: "hours",
    toDisplay: (s) => String(Math.round(s)),
    fromDisplay: (i) => {
      const n = Number(i);
      return Number.isFinite(n) && n >= 0 && n <= 720 && Number.isInteger(n)
        ? n
        : null;
    },
    formatStored: (s) => `${Math.round(s)} h`,
  },
  refund_late_renter_percent: {
    label: "Short-notice renter refund share",
    hint: "Percent the renter gets back on a short-notice cancellation (0-100).",
    unit: "%",
    toDisplay: (s) => String(Math.round(s * 100) / 100),
    fromDisplay: (i) => {
      const n = Number(i);
      return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
    },
    formatStored: (s) => `${Math.round(s * 100) / 100}%`,
  },
  arrival_checkin_lead_hours: {
    label: "Arrival check-in lead time",
    hint: "How early before pickup the arrival check-in opens (0-48 hours). Applies live.",
    unit: "hours",
    toDisplay: (s) => String(Math.round(s)),
    fromDisplay: (i) => {
      const n = Number(i);
      return Number.isFinite(n) && n >= 0 && n <= 48 && Number.isInteger(n)
        ? n
        : null;
    },
    formatStored: (s) => `${Math.round(s)} h`,
  },
  deposit_claim_window_hours: {
    label: "Security deposit claim window",
    hint: "Hours the lister has to file a deposit claim after completion (1-168). Applies live.",
    unit: "hours",
    toDisplay: (s) => String(Math.round(s)),
    fromDisplay: (i) => {
      const n = Number(i);
      return Number.isFinite(n) && n >= 1 && n <= 168 && Number.isInteger(n)
        ? n
        : null;
    },
    formatStored: (s) => `${Math.round(s)} h`,
  },
  lister_completion_timeout_hours: {
    label: "Lister completion timeout",
    hint: "After the renter completes, hours to wait for the lister before auto-completing (1-72). Applies live.",
    unit: "hours",
    toDisplay: (s) => String(Math.round(s)),
    fromDisplay: (i) => {
      const n = Number(i);
      return Number.isFinite(n) && n >= 1 && n <= 72 && Number.isInteger(n)
        ? n
        : null;
    },
    formatStored: (s) => `${Math.round(s)} h`,
  },
};

const FIELD_KEYS = Object.keys(FIELDS) as (keyof SettingsRow)[];

const requiredApprovals = (superAdminCount: number) =>
  Math.max(1, Math.ceil((superAdminCount * 2) / 3));

const formatStamp = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
};

export default function AdminPlatformSettingsPage() {
  const { profile } = useAuth();
  const isSuperAdmin = profile?.role === "super_admin";

  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<SettingsRow | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [proposing, setProposing] = useState(false);
  const [voting, setVoting] = useState(false);

  const [pending, setPending] = useState<ChangeRequest | null>(null);
  const [pendingVotes, setPendingVotes] = useState<VoteRow[]>([]);
  const [superAdminCount, setSuperAdminCount] = useState(1);
  const [history, setHistory] = useState<ChangeRequest[]>([]);

  const [contactEmail, setContactEmail] = useState(DEFAULT_CONTACT_EMAIL);
  const [contactDraft, setContactDraft] = useState(DEFAULT_CONTACT_EMAIL);
  const [savingContact, setSavingContact] = useState(false);

  const [etaUser, setEtaUser] = useState(DEFAULT_USER_VERIFICATION_ETA);
  const [etaUserDraft, setEtaUserDraft] = useState(DEFAULT_USER_VERIFICATION_ETA);
  const [etaVehicle, setEtaVehicle] = useState(DEFAULT_VEHICLE_VERIFICATION_ETA);
  const [etaVehicleDraft, setEtaVehicleDraft] = useState(
    DEFAULT_VEHICLE_VERIFICATION_ETA,
  );
  const [savingEta, setSavingEta] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [settingsRes, pendingRes, countRes, historyRes, contactRes, etaRes] = await Promise.all([
      supabase
        .from("platform_settings")
        .select(
          "commission_rate, payment_processing_fee_rate, payment_processing_fixed_centavos, downpayment_rate, refund_full_hours, refund_late_renter_percent, arrival_checkin_lead_hours, deposit_claim_window_hours, lister_completion_timeout_hours",
        )
        .eq("id", "default")
        .maybeSingle(),
      supabase
        .from("platform_setting_change_requests")
        .select("*")
        .eq("status", "pending")
        .maybeSingle(),
      supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "super_admin")
        .is("deleted_at", null),
      supabase
        .from("platform_setting_change_requests")
        .select("*")
        .neq("status", "pending")
        .order("resolved_at", { ascending: false })
        .limit(6),
      supabase.rpc("get_platform_contact_email"),
      supabase.rpc("get_verification_eta_messages"),
    ]);

    const loadedContact =
      typeof contactRes.data === "string" && isEmailShaped(contactRes.data)
        ? contactRes.data
        : DEFAULT_CONTACT_EMAIL;
    setContactEmail(loadedContact);
    setContactDraft(loadedContact);

    const etaData = (etaRes.data ?? {}) as {
      user_message?: string;
      vehicle_message?: string;
    };
    const loadedEtaUser =
      typeof etaData.user_message === "string" && etaData.user_message.trim()
        ? etaData.user_message.trim()
        : DEFAULT_USER_VERIFICATION_ETA;
    const loadedEtaVehicle =
      typeof etaData.vehicle_message === "string" && etaData.vehicle_message.trim()
        ? etaData.vehicle_message.trim()
        : DEFAULT_VEHICLE_VERIFICATION_ETA;
    setEtaUser(loadedEtaUser);
    setEtaUserDraft(loadedEtaUser);
    setEtaVehicle(loadedEtaVehicle);
    setEtaVehicleDraft(loadedEtaVehicle);

    if (settingsRes.error || !settingsRes.data) {
      toast.error("Could not load platform settings.");
      setLoading(false);
      return;
    }

    const row = settingsRes.data as SettingsRow;
    setSettings(row);
    setDrafts(
      Object.fromEntries(
        FIELD_KEYS.map((key) => [key, FIELDS[key].toDisplay(Number(row[key]))]),
      ),
    );
    setSuperAdminCount(Math.max(1, countRes.count ?? 1));
    setHistory((historyRes.data as ChangeRequest[]) ?? []);

    const pendingRow = (pendingRes.data as ChangeRequest | null) ?? null;
    setPending(pendingRow);
    if (pendingRow) {
      const { data: votes } = await supabase
        .from("platform_setting_change_votes")
        .select("request_id, voter_id, vote")
        .eq("request_id", pendingRow.id);
      setPendingVotes((votes as VoteRow[]) ?? []);
    } else {
      setPendingVotes([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const draftChanges = useMemo(() => {
    if (!settings) return null;
    const changes: Record<string, number> = {};
    let invalid: string | null = null;
    for (const key of FIELD_KEYS) {
      const parsed = FIELDS[key].fromDisplay(drafts[key] ?? "");
      if (parsed === null) {
        invalid = FIELDS[key].label;
        break;
      }
      if (Math.abs(parsed - Number(settings[key])) > 1e-9) {
        changes[key] = parsed;
      }
    }
    return { changes, invalid };
  }, [drafts, settings]);

  const handlePropose = async () => {
    if (!draftChanges || draftChanges.invalid) {
      toast.error(`Check the value for "${draftChanges?.invalid}".`);
      return;
    }
    if (Object.keys(draftChanges.changes).length === 0) {
      toast.info("No changes to propose.");
      return;
    }
    setProposing(true);
    try {
      const { error } = await supabase.rpc("propose_platform_setting_change", {
        p_changes: draftChanges.changes,
        p_reason: reason.trim() || null,
      });
      if (error) throw error;
      toast.success("Change proposed. Other super admins now review it.");
      setReason("");
      await load();
    } catch (err) {
      toast.error("Could not propose the change", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setProposing(false);
    }
  };

  const handleVote = async (vote: "approve" | "reject") => {
    if (!pending) return;
    setVoting(true);
    try {
      const { data, error } = await supabase.rpc("vote_platform_setting_change", {
        p_request_id: pending.id,
        p_vote: vote,
      });
      if (error) throw error;
      toast.success(
        data === "applied"
          ? "Threshold reached - the change is now live."
          : data === "rejected"
            ? "The proposal was rejected."
            : `Vote recorded (${vote}).`,
      );
      await load();
    } catch (err) {
      toast.error("Could not record your vote", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setVoting(false);
    }
  };

  const handleCancelProposal = async () => {
    if (!pending) return;
    setVoting(true);
    try {
      const { error } = await supabase.rpc("cancel_platform_setting_change", {
        p_request_id: pending.id,
      });
      if (error) throw error;
      toast.success("Proposal withdrawn.");
      await load();
    } catch (err) {
      toast.error("Could not withdraw the proposal", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setVoting(false);
    }
  };

  const handleSaveContactEmail = async () => {
    const cleaned = contactDraft.trim().toLowerCase();
    if (!isEmailShaped(cleaned)) {
      toast.error("Enter a valid email address.");
      return;
    }
    if (cleaned === contactEmail) {
      toast.info("That is already the platform contact email.");
      return;
    }
    setSavingContact(true);
    try {
      const { data, error } = await supabase.rpc("set_platform_contact_email", {
        p_email: cleaned,
      });
      if (error) throw error;
      const saved = typeof data === "string" ? data : cleaned;
      setContactEmail(saved);
      setContactDraft(saved);
      toast.success("Platform contact email updated. It now shows on Terms, Privacy, and the sign-in pages.");
    } catch (err) {
      toast.error("Could not update the contact email", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setSavingContact(false);
    }
  };

  const handleSaveEta = async () => {
    const nextUser = etaUserDraft.trim();
    const nextVehicle = etaVehicleDraft.trim();
    if (
      nextUser.length < 10 ||
      nextUser.length > 400 ||
      nextVehicle.length < 10 ||
      nextVehicle.length > 400
    ) {
      toast.error("Each message must be 10 to 400 characters.");
      return;
    }
    if (nextUser === etaUser && nextVehicle === etaVehicle) {
      toast.info("Those are already the live messages.");
      return;
    }
    setSavingEta(true);
    try {
      const { error } = await supabase.rpc("set_verification_eta_messages", {
        p_user_message: nextUser,
        p_vehicle_message: nextVehicle,
      });
      if (error) throw error;
      setEtaUser(nextUser);
      setEtaVehicle(nextVehicle);
      toast.success(
        "Verification ETA messages updated. They now show on the verification and My Vehicles pages.",
      );
    } catch (err) {
      toast.error("Could not update the ETA messages", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setSavingEta(false);
    }
  };

  const approvals = pendingVotes.filter((v) => v.vote === "approve").length;
  const rejects = pendingVotes.filter((v) => v.vote === "reject").length;
  const threshold = requiredApprovals(superAdminCount);
  const myVote = pendingVotes.find((v) => v.voter_id === profile?.id)?.vote ?? null;
  const isProposer = pending?.proposed_by === profile?.id;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Platform Configuration</h1>
        <p className="mt-1 text-muted-foreground">
          Money and policy values used across bookings. Every change is proposed
          by one super admin and needs {threshold} of {superAdminCount} super-admin
          approvals (two-thirds, re-checked on each vote) before it goes live.
          {!isSuperAdmin && " You can view the active values; only super admins can propose or vote."}
        </p>
      </div>

      {loading || !settings ? (
        <Card>
          <CardContent className="flex items-center gap-3 p-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading configuration...
          </CardContent>
        </Card>
      ) : (
        <>
          {pending ? (
            <Card className="border-amber-500/40 bg-amber-500/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Clock className="h-5 w-5 text-amber-500" />
                  Pending change - {approvals}/{threshold} approvals
                </CardTitle>
                <CardDescription>
                  Proposed {formatStamp(pending.created_at)} · expires{" "}
                  {formatStamp(pending.expires_at)}
                  {pending.reason ? ` · "${pending.reason}"` : ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5 rounded-lg border border-border/60 bg-background/60 p-3 text-sm">
                  {Object.entries(pending.changes).map(([key, next]) => {
                    const field = FIELDS[key as keyof SettingsRow];
                    return (
                      <div key={key} className="flex flex-wrap justify-between gap-2">
                        <span className="text-muted-foreground">{field?.label ?? key}</span>
                        <span>
                          <span className="line-through opacity-60">
                            {field ? field.formatStored(Number(pending.snapshot[key])) : String(pending.snapshot[key])}
                          </span>{" "}
                          <span aria-hidden>→</span>{" "}
                          <span className="font-semibold text-foreground">
                            {field ? field.formatStored(Number(next)) : String(next)}
                          </span>
                        </span>
                      </div>
                    );
                  })}
                </div>

                <p className="text-xs text-muted-foreground">
                  {approvals} approve · {rejects} reject · {superAdminCount} super
                  admins total{myVote ? ` · your vote: ${myVote}` : ""}
                </p>

                {isSuperAdmin ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant={myVote === "approve" ? "default" : "outline"}
                      onClick={() => handleVote("approve")}
                      disabled={voting}
                      className="gap-1"
                    >
                      <ThumbsUp className="h-4 w-4" /> Approve
                    </Button>
                    <Button
                      size="sm"
                      variant={myVote === "reject" ? "destructive" : "outline"}
                      onClick={() => handleVote("reject")}
                      disabled={voting}
                      className="gap-1"
                    >
                      <ThumbsDown className="h-4 w-4" /> Reject
                    </Button>
                    {isProposer ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleCancelProposal}
                        disabled={voting}
                        className="gap-1 text-muted-foreground"
                      >
                        <XCircle className="h-4 w-4" /> Withdraw
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings2 className="h-5 w-5 text-primary" />
                Active configuration
              </CardTitle>
              <CardDescription>
                {pending
                  ? "A change is pending review - propose again only after it resolves."
                  : "Edit a value and propose the change for super-admin review."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                {FIELD_KEYS.map((key) => {
                  const field = FIELDS[key];
                  return (
                    <div key={key} className="space-y-1.5">
                      <Label className="text-sm">{field.label}</Label>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          value={drafts[key] ?? ""}
                          onChange={(e) =>
                            setDrafts((d) => ({ ...d, [key]: e.target.value }))
                          }
                          disabled={!isSuperAdmin || Boolean(pending)}
                          className="max-w-[9rem]"
                        />
                        <span className="text-sm text-muted-foreground">
                          {field.unit}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          (live: {field.formatStored(Number(settings[key]))})
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">{field.hint}</p>
                    </div>
                  );
                })}
              </div>

              {isSuperAdmin && !pending ? (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-sm">Reason (optional)</Label>
                    <Input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      maxLength={500}
                      placeholder="Why this change is needed"
                    />
                  </div>
                  <Button
                    onClick={handlePropose}
                    disabled={
                      proposing ||
                      !draftChanges ||
                      Boolean(draftChanges.invalid) ||
                      Object.keys(draftChanges.changes).length === 0
                    }
                    className="gap-2"
                  >
                    {proposing ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Settings2 className="h-4 w-4" />
                    )}
                    Propose change
                    {draftChanges && Object.keys(draftChanges.changes).length > 0
                      ? ` (${Object.keys(draftChanges.changes).length})`
                      : ""}
                  </Button>
                </>
              ) : null}

              <div className="flex gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <p>
                  Existing bookings keep the downpayment and cancellation terms
                  they were created under - those only affect new bookings. The
                  three lifecycle timings (arrival lead, deposit claim window,
                  lister completion timeout) apply live to every booking.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5 text-primary" />
                Platform contact email
              </CardTitle>
              <CardDescription>
                The public address shown in the Terms of Service, Privacy Policy,
                sign-up notice, and the sign-in / password-reset help text. This
                is contact information, not a money or policy value, so a single
                super admin can change it directly - no proposal or vote.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-sm">Contact email</Label>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    type="email"
                    value={contactDraft}
                    onChange={(e) => setContactDraft(e.target.value)}
                    disabled={!isSuperAdmin || savingContact}
                    className="max-w-sm"
                  />
                  {isSuperAdmin ? (
                    <Button
                      onClick={handleSaveContactEmail}
                      disabled={
                        savingContact ||
                        contactDraft.trim().toLowerCase() === contactEmail
                      }
                      className="gap-2"
                    >
                      {savingContact ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Mail className="h-4 w-4" />
                      )}
                      Save email
                    </Button>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  Live: {contactEmail}
                  {!isSuperAdmin && " · only a super admin can change this."}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-primary" />
                Verification ETA messages
              </CardTitle>
              <CardDescription>
                The "how long does review take" wording shown to users after they
                submit identity verification, and to listers after they submit a
                vehicle. Display text, not a policy value, so a single super
                admin edits it directly - raise it during a peak season so
                nobody complains that day 3 passed with no decision.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-sm">User identity verification</Label>
                <textarea
                  value={etaUserDraft}
                  onChange={(e) => setEtaUserDraft(e.target.value)}
                  disabled={!isSuperAdmin || savingEta}
                  maxLength={400}
                  rows={2}
                  className="min-h-16 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-60"
                />
                <p className="text-xs text-muted-foreground">
                  Live: {etaUser}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Vehicle listing verification</Label>
                <textarea
                  value={etaVehicleDraft}
                  onChange={(e) => setEtaVehicleDraft(e.target.value)}
                  disabled={!isSuperAdmin || savingEta}
                  maxLength={400}
                  rows={2}
                  className="min-h-16 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-60"
                />
                <p className="text-xs text-muted-foreground">
                  Live: {etaVehicle}
                  {!isSuperAdmin && " · only a super admin can change these."}
                </p>
              </div>
              {isSuperAdmin ? (
                <Button
                  onClick={handleSaveEta}
                  disabled={
                    savingEta ||
                    (etaUserDraft.trim() === etaUser &&
                      etaVehicleDraft.trim() === etaVehicle)
                  }
                  className="gap-2"
                >
                  {savingEta ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Clock className="h-4 w-4" />
                  )}
                  Save messages
                </Button>
              ) : null}
            </CardContent>
          </Card>

          {history.length > 0 ? (
            <Card className="border-border/50">
              <CardHeader>
                <CardTitle className="text-base">Recent decisions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {history.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-2 last:border-0 last:pb-0"
                  >
                    <span className="flex items-center gap-2">
                      {item.status === "applied" ? (
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                      ) : (
                        <XCircle className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className="capitalize">{item.status}</span>
                      <span className="text-muted-foreground">
                        {Object.keys(item.changes).join(", ")}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {item.resolved_at ? formatStamp(item.resolved_at) : ""}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}

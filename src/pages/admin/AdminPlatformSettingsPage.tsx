import { useEffect, useState } from "react";
import { CreditCard, Info, Loader2, Percent, Settings2 } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase";
import {
  commissionPercentToRate,
  commissionRateToPercent,
  calculateCommissionAmount,
  DEFAULT_COMMISSION_PERCENT,
  DEFAULT_COMMISSION_RATE,
  formatCommissionPercent,
} from "@/lib/platformSettings";

export default function AdminPlatformSettingsPage() {
  const { profile } = useAuth();
  const isSuperAdmin = profile?.role === "super_admin";
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedCommissionRate, setSavedCommissionRate] = useState(
    DEFAULT_COMMISSION_RATE,
  );
  const [commissionPercent, setCommissionPercent] = useState(
    String(DEFAULT_COMMISSION_PERCENT),
  );
  const [savedProcessingRate, setSavedProcessingRate] = useState(0);
  const [processingPercent, setProcessingPercent] = useState("0");
  const [savedProcessingFixedCentavos, setSavedProcessingFixedCentavos] = useState(0);
  const [processingFixedPesos, setProcessingFixedPesos] = useState("0");

  useEffect(() => {
    void (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("platform_settings")
        .select("commission_rate, payment_processing_fee_rate, payment_processing_fixed_centavos")
        .eq("id", "default")
        .maybeSingle();

      if (error) {
        console.error("Failed to load platform settings:", error);
        toast.error("Could not load platform settings.");
        setSavedCommissionRate(DEFAULT_COMMISSION_RATE);
        setCommissionPercent(String(DEFAULT_COMMISSION_PERCENT));
      } else {
        const rate = Number(data?.commission_rate ?? DEFAULT_COMMISSION_RATE);
        setSavedCommissionRate(rate);
        setCommissionPercent(String(commissionRateToPercent(rate)));
        const processingRate = Number(data?.payment_processing_fee_rate ?? 0);
        const processingFixed = Number(data?.payment_processing_fixed_centavos ?? 0);
        setSavedProcessingRate(processingRate);
        setProcessingPercent(String(commissionRateToPercent(processingRate)));
        setSavedProcessingFixedCentavos(processingFixed);
        setProcessingFixedPesos(String(processingFixed / 100));
      }
      setLoading(false);
    })();
  }, []);

  const handleSave = async () => {
    if (!isSuperAdmin) {
      toast.error("Only the super admin can update platform settings.");
      return;
    }

    const nextRate = commissionPercentToRate(commissionPercent);
    const nextProcessingRate = commissionPercentToRate(processingPercent);
    const nextProcessingFixedCentavos = Math.round(Number(processingFixedPesos) * 100);
    if (nextRate === null) {
      toast.error("Set the SafeDrive commission between 0% and 100%.");
      return;
    }
    if (nextProcessingRate === null || nextProcessingRate > 0.25 || !Number.isInteger(nextProcessingFixedCentavos) || nextProcessingFixedCentavos < 0) {
      toast.error("Set the PayMongo percentage between 0% and 25%, and use a non-negative fixed peso amount.");
      return;
    }

    if (Math.abs(nextRate - savedCommissionRate) < 0.000001 && Math.abs(nextProcessingRate - savedProcessingRate) < 0.000001 && nextProcessingFixedCentavos === savedProcessingFixedCentavos) {
      toast.info("No commission change to save.");
      return;
    }

    setSaving(true);

    const { error } = await supabase.from("platform_settings").upsert(
      {
        id: "default",
        commission_rate: nextRate,
        payment_processing_fee_rate: nextProcessingRate,
        payment_processing_fixed_centavos: nextProcessingFixedCentavos,
      },
      { onConflict: "id" },
    );

    if (error) {
      console.error("Failed to save platform settings:", error);
      toast.error("Could not save the commission setting.", {
        description: error.message,
      });
    } else {
      const { error: auditError } = await supabase.from("audit_log").insert({
        user_id: profile.id,
        action: "super_admin_updated_pricing_settings",
        entity_type: "platform_settings",
        entity_id: "default",
        details: {
          admin_email: profile.email,
          previous_rate: savedCommissionRate,
          previous_percent: commissionRateToPercent(savedCommissionRate),
          next_rate: nextRate,
          next_percent: commissionRateToPercent(nextRate),
          previous_processing_fee_percent: commissionRateToPercent(savedProcessingRate),
          next_processing_fee_percent: commissionRateToPercent(nextProcessingRate),
          previous_processing_fixed_centavos: savedProcessingFixedCentavos,
          next_processing_fixed_centavos: nextProcessingFixedCentavos,
        },
      });

      if (auditError) {
        console.warn("Commission change audit log insert failed:", auditError.message);
      }

      setSavedCommissionRate(nextRate);
      setCommissionPercent(String(commissionRateToPercent(nextRate)));
      setSavedProcessingRate(nextProcessingRate);
      setProcessingPercent(String(commissionRateToPercent(nextProcessingRate)));
      setSavedProcessingFixedCentavos(nextProcessingFixedCentavos);
      setProcessingFixedPesos(String(nextProcessingFixedCentavos / 100));
      toast.success("Commission setting updated.", {
        description: `SafeDrive now uses ${formatCommissionPercent(nextRate)} as the platform commission.`,
      });
    }
    setSaving(false);
  };

  const currentCommissionRate =
    commissionPercentToRate(commissionPercent) ?? DEFAULT_COMMISSION_RATE;
  const hasCommissionChanged =
    Math.abs(currentCommissionRate - savedCommissionRate) >= 0.000001 ||
    Math.abs((commissionPercentToRate(processingPercent) ?? 0) - savedProcessingRate) >= 0.000001 ||
    Math.round(Number(processingFixedPesos || 0) * 100) !== savedProcessingFixedCentavos;
  const sampleBaseRental = 10000;
  const sampleCommission = calculateCommissionAmount(
    sampleBaseRental,
    currentCommissionRate,
  );
  const sampleProcessingRate = commissionPercentToRate(processingPercent) ?? 0;
  const sampleSubtotal = sampleBaseRental + sampleCommission;
  const sampleProcessingFee = sampleProcessingRate < 1
    ? Math.max(0, ((sampleSubtotal + Number(processingFixedPesos || 0)) / (1 - sampleProcessingRate)) - sampleSubtotal)
    : 0;
  const sampleListerReceives = sampleBaseRental;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Platform Settings</h1>
        <p className="mt-1 text-muted-foreground">
          Control SafeDrive's service commission separately from any verified payment-provider cost passed to the renter.
          {!isSuperAdmin && " You can view the active values; only the super admin can change them."}
        </p>
      </div>

      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings2 className="h-5 w-5 text-primary" />
            Commission Control
          </CardTitle>
          <CardDescription>
            This affects the service fee shown on listings, booking totals, and the commission kept before lister payout.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {loading ? (
            <div className="text-sm text-muted-foreground">Loading current platform settings...</div>
          ) : (
            <>
              <div className="max-w-sm space-y-2">
                <label className="text-sm font-medium">Commission percentage</label>
                <div className="relative">
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={commissionPercent}
                    onChange={(event) => setCommissionPercent(event.target.value)}
                    disabled={!isSuperAdmin}
                    className="pr-10"
                  />
                  <Percent className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                </div>
                <p className="text-xs text-muted-foreground">
                  Example: entering <strong>12.5</strong> means SafeDrive keeps 12.5% of the booking total as platform commission.
                </p>
              </div>

              <div className="max-w-2xl rounded-xl border border-border/60 bg-background/40 p-4">
                <div className="flex items-start gap-3">
                  <CreditCard className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  <div>
                    <h3 className="font-medium">Payment-provider cost recovery</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      These two fields are only for a confirmed PayMongo charge that SafeDrive chooses to disclose and pass to the renter. They are not additional SafeDrive commission and they never reduce the lister's base rental.
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Provider percentage charged to renter</label>
                    <Input type="number" min="0" max="25" step="0.01" value={processingPercent} onChange={(event) => setProcessingPercent(event.target.value)} disabled={!isSuperAdmin} />
                    <p className="text-xs text-muted-foreground">Example: enter 3.5 only if the applicable provider rate is confirmed as 3.5%.</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Provider fixed charge to renter (PHP)</label>
                    <Input type="number" min="0" step="0.01" value={processingFixedPesos} onChange={(event) => setProcessingFixedPesos(event.target.value)} disabled={!isSuperAdmin} />
                    <p className="text-xs text-muted-foreground">Use this only when the applicable method also has a fixed peso charge.</p>
                  </div>
                </div>

                <div className="mt-4 flex gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-muted-foreground">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                  <p><strong className="text-foreground">Current safe setting: 0 and 0.</strong> Leave both at zero until the exact test/live PayMongo pricing for every enabled payment method is confirmed. Zero means SafeDrive does not add a separate provider-cost charge.</p>
                </div>
              </div>

              <div className="rounded-xl border border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">Current preview</p>
                <p className="mt-1">
                  A P10,000 base rental with a <strong>{commissionPercent || "0"}%</strong> commission will show a service fee of{" "}
                  <strong>P{sampleCommission.toLocaleString()}</strong>.
                </p>
                <p className="mt-2">
                  The renter pays approximately <strong>P{(sampleSubtotal + sampleProcessingFee).toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong>, including a disclosed processing amount of <strong>P{sampleProcessingFee.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong>. SafeDrive's commission is on top of the base rental, and the lister receives <strong>P{sampleListerReceives.toLocaleString()}</strong> before any approved damage deductions.
                </p>
              </div>

              {isSuperAdmin && <Button onClick={handleSave} disabled={saving || !hasCommissionChanged} className="gap-2">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Settings2 className="h-4 w-4" />}
                Save pricing settings
              </Button>}
              {!hasCommissionChanged ? (
                <p className="text-xs text-muted-foreground">
                  The current value already matches the saved platform commission.
                </p>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

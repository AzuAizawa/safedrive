import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { DatabaseZap, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";

const requestTypes = [
  "access",
  "correction",
  "deletion",
  "anonymization",
  "restriction",
] as const;

type RequestType = (typeof requestTypes)[number];
type RequestRow = {
  id: string;
  request_type: string;
  status: string;
  request_details: string;
  decision_reason: string | null;
  legal_hold_reason: string | null;
  due_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

const isRequestType = (value: string | null): value is RequestType =>
  requestTypes.includes(value as RequestType);

const readResponse = async <T,>(response: Response): Promise<T> =>
  (await response.json().catch(() => ({}))) as T;

export default function PrivacyRequestPage() {
  const { session } = useAuth();
  const [searchParams] = useSearchParams();
  const requestedType = searchParams.get("type");
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [requestType, setRequestType] = useState<RequestType>(() =>
    isRequestType(requestedType) ? requestedType : "access",
  );
  const [details, setDetails] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isRequestType(requestedType)) setRequestType(requestedType);
  }, [requestedType]);

  const load = useCallback(async () => {
    if (!session?.access_token) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/data-request", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      });
      const result = await readResponse<{
        error?: string;
        requests?: RequestRow[];
      }>(response);
      if (!response.ok) {
        throw new Error(result.error || "Privacy requests could not be loaded.");
      }
      setRequests(result.requests ?? []);
    } catch (error) {
      toast.error("Requests could not be loaded", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setLoading(false);
    }
  }, [session?.access_token]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!session?.access_token || saving) return;

    setSaving(true);
    try {
      const response = await fetch("/api/data-request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ requestType, details }),
      });
      const result = await readResponse<{ error?: string }>(response);
      if (!response.ok) {
        throw new Error(result.error || "Privacy request was not submitted.");
      }

      toast.success("Privacy request submitted");
      setDetails("");
      await load();
    } catch (error) {
      toast.error("Request was not submitted", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold">
          <DatabaseZap className="h-7 w-7" /> Privacy &amp; Data Requests
        </h1>
        <p className="mt-1 text-muted-foreground">
          Ask for access, correction, deletion, anonymization, or restricted
          processing. Deletion is reviewed because financial, contract,
          dispute, fraud, or legal-hold records may need to be retained or
          anonymized instead.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-4 rounded-xl border bg-card p-5">
        <label className="block space-y-2">
          <Label>Request type</Label>
          <select
            className="h-10 w-full rounded-md border bg-background px-3"
            value={requestType}
            onChange={(event) => setRequestType(event.target.value as RequestType)}
          >
            <option value="access">Access my data</option>
            <option value="correction">Correct my data</option>
            <option value="deletion">Delete eligible data</option>
            <option value="anonymization">Anonymize eligible data</option>
            <option value="restriction">Restrict processing</option>
          </select>
        </label>

        <label className="block space-y-2">
          <Label>Details</Label>
          <textarea
            className="min-h-32 w-full rounded-md border bg-background p-3 text-sm"
            maxLength={3000}
            value={details}
            onChange={(event) => setDetails(event.target.value)}
            required
            placeholder="Describe what you are requesting and the relevant account or transaction."
          />
        </label>

        <Button type="submit" disabled={saving || details.trim().length < 10}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Submit request
        </Button>
      </form>

      <section>
        <h2 className="text-xl font-semibold">Your requests</h2>
        {loading ? (
          <Loader2 className="mt-4 h-5 w-5 animate-spin" />
        ) : requests.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed p-6 text-muted-foreground">
            No privacy requests yet.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {requests.map((item) => (
              <article key={item.id} className="rounded-xl border bg-card p-4">
                <p className="font-medium">
                  {item.request_type.replace(/_/g, " ")} ·{" "}
                  {item.status.replace(/_/g, " ")}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {item.request_details}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Submitted {new Date(item.created_at).toLocaleString()}
                  {item.due_at
                    ? ` · Review target ${new Date(item.due_at).toLocaleDateString()}`
                    : ""}
                </p>
                {(item.decision_reason || item.legal_hold_reason) && (
                  <p className="mt-2 text-sm">
                    Decision: {item.decision_reason || item.legal_hold_reason}
                  </p>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

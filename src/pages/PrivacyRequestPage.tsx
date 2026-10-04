import { useState } from "react";
import { useNavigate } from "react-router";
import { DatabaseZap, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Your Data (CHAPTER 121). A member downloads their own data here; deleting
 * the account is Delete account in Account settings (CHAPTER 96); anything
 * else - a correction, a restriction - is a support ticket tagged Privacy /
 * Data. Nothing here waits on an admin.
 */
export default function PrivacyRequestPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [downloading, setDownloading] = useState(false);

  const download = async () => {
    if (!session?.access_token || downloading) return;
    setDownloading(true);
    try {
      const response = await fetch("/api/data-request", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || "Your data could not be prepared.");
      }
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = `safedrive-my-data-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(href);
      toast.success("Your data was downloaded");
    } catch (error) {
      toast.error("Download failed", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold">
          <DatabaseZap className="h-7 w-7" /> Your Data
        </h1>
        <p className="mt-1 text-muted-foreground">
          See what SafeDrive keeps about you, and what you can do with it.
        </p>
      </div>

      <section className="space-y-3 rounded-xl border bg-card p-5">
        <h2 className="font-semibold">Download my data</h2>
        <p className="text-sm text-muted-foreground">
          One file with your profile, your bookings as a renter and as a lister, their payments,
          the vehicles you listed, the reviews you wrote and received, and your support tickets with
          the messages you sent. Your ID numbers and ID photos, arrival locations and photos, and
          other people's personal details are not included.
        </p>
        <Button type="button" onClick={() => void download()} disabled={downloading}>
          {downloading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-2 h-4 w-4" />
          )}
          Download my data
        </Button>
      </section>

      <section className="space-y-2 rounded-xl border bg-card p-5">
        <h2 className="font-semibold">Delete my account</h2>
        <p className="text-sm text-muted-foreground">
          Use Delete account in Account settings. Your account is hidden and deleted after a grace
          period; signing in and choosing to keep it before then cancels the deletion. Bookings and
          payments you took part in are kept without your name. An account nobody signs in to for a
          long time is scheduled for deletion the same way, with a notice by email first.
        </p>
      </section>

      <section className="space-y-2 rounded-xl border bg-card p-5">
        <h2 className="font-semibold">Anything else</h2>
        <p className="text-sm text-muted-foreground">
          To correct your details, restrict how SafeDrive uses your data, or ask any other privacy
          question, open a support ticket and SafeDrive will answer you there.
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={() => navigate("/support?tag=privacy&subject=Privacy%20request")}
        >
          Open a support ticket
        </Button>
      </section>
    </div>
  );
}

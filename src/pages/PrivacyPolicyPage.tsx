import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Shield, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocation, useNavigate } from "react-router";
import { useAuth } from "@/contexts/AuthContext";
import { usePlatformContactEmail } from "@/lib/platformSettings";
import { supabase } from "@/lib/supabase";
import { sanitizeLegalDocumentHtml } from "@/lib/richText";

export default function PrivacyPolicyPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { profile } = useAuth();
  const contactEmail = usePlatformContactEmail();
  const [contentHtml, setContentHtml] = useState<string | null>(null);
  const [publishedAt, setPublishedAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("legal_document_versions")
        .select("content_html, published_at")
        .eq("document_key", "privacy_policy")
        .eq("status", "published")
        .maybeSingle();
      if (!cancelled) {
        setContentHtml(data?.content_html ?? "");
        setPublishedAt(data?.published_at ?? null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleBack = () => {
    const returnTo =
      typeof location.state?.returnTo === "string"
        ? location.state.returnTo
        : null;

    if (returnTo) {
      navigate(returnTo, { replace: true });
      return;
    }

    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate(profile?.is_lister ? "/lister-bookings" : profile ? "/browse" : "/");
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-4xl mx-auto py-12 px-4 animate-fade-in">
        <Button variant="ghost" size="sm" className="-ml-2 mb-6" onClick={handleBack}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>

        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Lock className="w-5 h-5 text-primary" />
          </div>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">Privacy Policy</h1>
        </div>
        <p className="text-muted-foreground text-sm mb-10">
          {publishedAt ? `Last Updated: ${new Date(publishedAt).toLocaleDateString()}` : "Loading..."}
        </p>

        {contentHtml === null ? (
          <div className="flex items-center gap-3 py-16 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading...
          </div>
        ) : (
          <div
            className="prose prose-sm dark:prose-invert max-w-none space-y-8 text-foreground/90 leading-relaxed"
            dangerouslySetInnerHTML={{
              __html: sanitizeLegalDocumentHtml(
                contentHtml.replaceAll("{{CONTACT_EMAIL}}", contactEmail),
              ),
            }}
          />
        )}

        <div className="mt-12 pt-8 border-t border-border/40 text-center">
          <div className="flex items-center justify-center gap-2 text-muted-foreground text-sm">
            <Shield className="w-4 h-4" />
            <span>SafeDrive - Peer-to-Peer Car Rental Platform</span>
          </div>
          <p className="text-xs text-muted-foreground/60 mt-2">
            Privacy controls designed with RA 10173 and its implementing rules in view
          </p>
        </div>
      </div>
    </div>
  );
}

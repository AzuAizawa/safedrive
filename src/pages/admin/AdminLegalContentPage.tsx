import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bold,
  FileText,
  Heading2,
  History,
  Italic,
  List,
  ListOrdered,
  Loader2,
  Underline as UnderlineIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/lib/supabase";
import { sanitizeLegalDocumentHtml } from "@/lib/richText";
import ConfirmDialog from "@/components/ConfirmDialog";
import type { LegalDocumentVersionRow } from "@/types/database";

const DOCUMENT_KEYS = [
  { key: "terms_of_service", label: "Terms and Conditions" },
  { key: "privacy_policy", label: "Privacy Policy" },
  { key: "platform_agreement", label: "Platform Agreement" },
] as const;

type DocumentKey = (typeof DOCUMENT_KEYS)[number]["key"];

export default function AdminLegalContentPage() {
  const { profile } = useAuth();
  const isSuperAdmin = profile?.role === "super_admin";

  const [activeKey, setActiveKey] = useState<DocumentKey>("terms_of_service");
  const [loading, setLoading] = useState(true);
  const [published, setPublished] = useState<LegalDocumentVersionRow | null>(null);
  const [history, setHistory] = useState<LegalDocumentVersionRow[]>([]);
  const [previewVersion, setPreviewVersion] = useState<LegalDocumentVersionRow | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);

  const fetchDocument = useCallback(async (key: DocumentKey) => {
    setLoading(true);
    setPreviewVersion(null);
    try {
      const { data, error } = await supabase
        .from("legal_document_versions")
        .select("*")
        .eq("document_key", key)
        .order("version_number", { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as LegalDocumentVersionRow[];
      setPublished(rows.find((row) => row.status === "published") ?? null);
      setHistory(rows);
    } catch (err) {
      toast.error("Could not load this document", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchDocument(activeKey);
  }, [activeKey, fetchDocument]);

  // Runs after the editor div actually mounts (post-render), not inside the
  // fetch itself - the div is unmounted while loading, so setting innerHTML
  // during the fetch would target a stale or missing node.
  useEffect(() => {
    if (!loading && editorRef.current) {
      editorRef.current.innerHTML = published?.content_html ?? "";
    }
  }, [loading, published]);

  const applyFormat = (command: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
  };

  const handlePublish = async () => {
    if (!editorRef.current) return;
    const html = sanitizeLegalDocumentHtml(editorRef.current.innerHTML);
    if (!html.trim()) {
      toast.error("Content cannot be empty.");
      return;
    }
    setPublishing(true);
    try {
      const { error } = await supabase.rpc("publish_legal_document_version", {
        p_document_key: activeKey,
        p_content_html: html,
      });
      if (error) throw error;
      toast.success("Published. The public page now shows this version.");
      setConfirmOpen(false);
      await fetchDocument(activeKey);
    } catch (err) {
      toast.error("Could not publish", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setPublishing(false);
    }
  };

  const activeLabel = DOCUMENT_KEYS.find((d) => d.key === activeKey)?.label ?? activeKey;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Legal Content</h1>
        <p className="mt-1 text-muted-foreground">
          Edit the Terms and Conditions, Privacy Policy, and Platform Agreement shown to
          users.{" "}
          {isSuperAdmin
            ? "Publishing goes live immediately - every past version is kept for the audit trail."
            : "Only a super admin can publish changes; you can view the published content and history."}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {DOCUMENT_KEYS.map((doc) => (
          <Button
            key={doc.key}
            size="sm"
            variant={activeKey === doc.key ? "default" : "outline"}
            onClick={() => setActiveKey(doc.key)}
          >
            {doc.label}
          </Button>
        ))}
      </div>

      {loading ? (
        <Card>
          <CardContent className="flex items-center gap-3 p-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading {activeLabel}...
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                {activeLabel}
              </CardTitle>
              <CardDescription>
                {published
                  ? `Currently published: version ${published.version_number} · ${new Date(published.published_at).toLocaleString()}`
                  : "No published version yet."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {isSuperAdmin && (
                <div className="flex flex-wrap gap-1 rounded-md border border-border/60 bg-muted/20 p-1.5">
                  <Button type="button" size="sm" variant="ghost" onClick={() => applyFormat("bold")} title="Bold">
                    <Bold className="h-4 w-4" />
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => applyFormat("italic")} title="Italic">
                    <Italic className="h-4 w-4" />
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => applyFormat("underline")} title="Underline">
                    <UnderlineIcon className="h-4 w-4" />
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => applyFormat("insertUnorderedList")} title="Bullet list">
                    <List className="h-4 w-4" />
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => applyFormat("insertOrderedList")} title="Numbered list">
                    <ListOrdered className="h-4 w-4" />
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => applyFormat("formatBlock", "<h3>")} title="Heading">
                    <Heading2 className="h-4 w-4" />
                  </Button>
                </div>
              )}
              <div
                ref={editorRef}
                contentEditable={isSuperAdmin}
                suppressContentEditableWarning
                className="prose prose-sm dark:prose-invert max-w-none min-h-[300px] rounded-md border border-input bg-background px-4 py-3 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring"
              />
              {isSuperAdmin && (
                <Button onClick={() => setConfirmOpen(true)} disabled={publishing} className="gap-2">
                  {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                  Publish New Version
                </Button>
              )}
            </CardContent>
          </Card>

          {history.length > 0 && (
            <Card className="border-border/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <History className="h-4 w-4" />
                  Version history
                </CardTitle>
                <CardDescription>Read-only - viewing an older version does not change what's published.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {history.map((version) => (
                  <div key={version.id} className="flex items-center justify-between rounded-md border border-border/50 px-3 py-2 text-sm">
                    <div>
                      <span className="font-medium">Version {version.version_number}</span>{" "}
                      <span className="text-xs text-muted-foreground">
                        {version.status === "published" ? "· live" : "· superseded"} ·{" "}
                        {new Date(version.published_at).toLocaleString()}
                      </span>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => setPreviewVersion(version)}>
                      View
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={`Publish ${activeLabel}?`}
        description="This replaces the currently published version immediately for every user. The previous version stays in the history below."
        confirmText="Publish"
        isLoading={publishing}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handlePublish}
      />

      {previewVersion && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setPreviewVersion(null)}
        >
          <div
            className="max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border/70 bg-card p-6 text-card-foreground shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold">
                {activeLabel} - version {previewVersion.version_number}
              </h2>
              <Button size="sm" variant="ghost" onClick={() => setPreviewVersion(null)}>
                Close
              </Button>
            </div>
            <div
              className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed"
              dangerouslySetInnerHTML={{ __html: sanitizeLegalDocumentHtml(previewVersion.content_html) }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

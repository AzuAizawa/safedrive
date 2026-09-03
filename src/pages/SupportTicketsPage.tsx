import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { format } from "date-fns";
import {
  BookOpen,
  CheckCircle2,
  Clock,
  FileText,
  ImageIcon,
  Loader2,
  MessageSquare,
  Paperclip,
  Plus,
  Send,
  Ticket,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import { helpArticles, helpCategories, type HelpCategory } from "@/lib/helpCenter";
import { supabase } from "@/lib/supabase";
import { uploadFile } from "@/lib/uploadUtils";
import {
  getTicketAttachmentUrl,
  getTicketTagLabels,
  isConversationTicket,
  isTicketAttachmentImage,
  resolveTicketSender,
  serializeTicketTags,
  ticketAttachmentAccept,
  ticketAttachmentBucket,
  ticketTags,
} from "@/lib/supportTickets";
import {
  formatRichTextForDisplay,
  normalizeRichTextInput,
  richTextHasVisibleContent,
} from "@/lib/richText";
import type { SupportTicket, TicketMessage } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const plainTextToEditorHtml = (value: string) =>
  escapeHtml(value).replace(/\n/g, "<br />");

export default function SupportTicketsPage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTicket, setActiveTicket] = useState<SupportTicket | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [senderProfiles, setSenderProfiles] = useState<
    Record<string, { full_name: string | null; role: string }>
  >({});
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [newMessage, setNewMessage] = useState("");
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [replyAttachment, setReplyAttachment] = useState<File | null>(null);

  const [isCreating, setIsCreating] = useState(false);
  const [isCreatingTicket, setIsCreatingTicket] = useState(false);
  const [ticketView, setTicketView] = useState<"support" | "messages">("support");
  const [newSubject, setNewSubject] = useState("");
  const [newTags, setNewTags] = useState<string[]>(["general"]);
  const [newBookingId, setNewBookingId] = useState("");
  const [newInitialMessage, setNewInitialMessage] = useState("");
  const [createAttachment, setCreateAttachment] = useState<File | null>(null);
  const [prefillCreateMessage, setPrefillCreateMessage] = useState<string>("");
  const [helpQuery, setHelpQuery] = useState("");
  const [helpFilter, setHelpFilter] = useState<"all" | HelpCategory>("all");

  const messageComposerRef = useRef<HTMLDivElement | null>(null);
  const createMessageComposerRef = useRef<HTMLDivElement | null>(null);
  const messagesScrollRef = useRef<HTMLDivElement | null>(null);
  const replyAttachmentInputRef = useRef<HTMLInputElement | null>(null);
  const createAttachmentInputRef = useRef<HTMLInputElement | null>(null);

  const clearReplyAttachment = () => {
    setReplyAttachment(null);
    if (replyAttachmentInputRef.current) {
      replyAttachmentInputRef.current.value = "";
    }
  };

  const clearCreateAttachment = () => {
    setCreateAttachment(null);
    if (createAttachmentInputRef.current) {
      createAttachmentInputRef.current.value = "";
    }
  };

  const buildAttachmentPath = (ticketId: string, file: File) => {
    const extension = file.name.includes(".")
      ? file.name.split(".").pop()
      : undefined;
    const safeBaseName = file.name
      .replace(/\.[^/.]+$/, "")
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .slice(0, 40);
    return `support-tickets/${ticketId}/${Date.now()}_${safeBaseName}${extension ? `.${extension}` : ""}`;
  };

  const uploadTicketAttachment = async (ticketId: string, file: File) => {
    const storagePath = buildAttachmentPath(ticketId, file);
    const result = await uploadFile(file, ticketAttachmentBucket, storagePath);

    if (!result.success) {
      throw new Error(result.error || "Failed to upload attachment");
    }

    return {
      attachment_name: file.name,
      attachment_mime_type: file.type || "application/octet-stream",
      attachment_storage_path: storagePath,
    };
  };

  useEffect(() => {
    const bookingId = searchParams.get("bookingId");
    const tag = searchParams.get("tag");
    const subject = searchParams.get("subject");
    const body = searchParams.get("body");

    if (bookingId || tag || subject || body) {
      setNewBookingId(bookingId ?? "");
      setNewTags(
        tag
          ? tag
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean)
          : ["booking_report"],
      );
      setNewSubject(subject ?? "Booking report");
      const nextPrefill = body ? plainTextToEditorHtml(body) : "";
      setPrefillCreateMessage(nextPrefill);
      setNewInitialMessage(nextPrefill);
      setIsCreating(true);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!isCreating || !prefillCreateMessage || !createMessageComposerRef.current) return;
    if (createMessageComposerRef.current.innerHTML.trim().length > 0) return;
    createMessageComposerRef.current.innerHTML = prefillCreateMessage;
  }, [isCreating, prefillCreateMessage]);

  useEffect(() => {
    // Keep the thread pinned to the latest message without moving the page
    // itself (scrollIntoView would also scroll the surrounding layout).
    const el = messagesScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const fetchTickets = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    const { data, error } = await supabase
      .from("support_tickets")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error && data) {
      setTickets(data);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void fetchTickets();
  }, [fetchTickets]);

  const fetchMessages = async (ticketId: string) => {
    setMessagesLoading(true);

    const { data, error } = await supabase
      .from("ticket_messages")
      .select("*")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: true });

    if (!error && data) {
      setMessages(data);

      const senderIds = [...new Set(data.map((message) => message.sender_id))];
      if (senderIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name, role")
          .in("id", senderIds);
        setSenderProfiles(
          Object.fromEntries(
            (profiles ?? []).map((profile) => [
              profile.id,
              { full_name: profile.full_name, role: profile.role },
            ]),
          ),
        );
      } else {
        setSenderProfiles({});
      }

      const entries = await Promise.all(
        data
          .filter((message) => Boolean(message.attachment_storage_path))
          .map(async (message) => [
            message.id,
            await getTicketAttachmentUrl(message.attachment_storage_path),
          ] as const),
      );
      setAttachmentUrls(
        Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry[1]))),
      );
    } else {
      setAttachmentUrls({});
      setSenderProfiles({});
    }
    setMessagesLoading(false);
  };

  const handleOpenTicket = (ticket: SupportTicket) => {
    setActiveTicket(ticket);
    setNewMessage("");
    clearReplyAttachment();
    if (messageComposerRef.current) {
      messageComposerRef.current.innerHTML = "";
    }
    void fetchMessages(ticket.id);
  };

  const resetCreateTicketForm = () => {
    setIsCreating(false);
    setIsCreatingTicket(false);
    setNewSubject("");
    setNewTags(["general"]);
    setNewBookingId("");
    setNewInitialMessage("");
    setPrefillCreateMessage("");
    clearCreateAttachment();

    if (createMessageComposerRef.current) {
      createMessageComposerRef.current.innerHTML = "";
    }
  };

  const handleCreateTicket = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (
      !user ||
      !newSubject.trim() ||
      (!richTextHasVisibleContent(newInitialMessage) && !createAttachment) ||
      isCreatingTicket
    ) {
      return;
    }

    setIsCreatingTicket(true);
    const initialMessage = normalizeRichTextInput(newInitialMessage);

    const { data: ticketResult, error: ticketError } = await supabase
      .from("support_tickets")
      .insert({
        user_id: user.id,
        subject: newSubject,
        tag: serializeTicketTags(newTags),
        booking_id: newBookingId || null,
        status: "open",
      })
      .select()
      .single();

    if (ticketError || !ticketResult) {
      toast.error("Failed to create ticket");
      setIsCreatingTicket(false);
      return;
    }

    let attachmentFields: {
      attachment_name?: string | null;
      attachment_mime_type?: string | null;
      attachment_storage_path?: string | null;
    } = {};

    if (createAttachment) {
      try {
        attachmentFields = await uploadTicketAttachment(
          ticketResult.id,
          createAttachment,
        );
      } catch (error) {
        await supabase
          .from("support_tickets")
          .delete()
          .eq("id", ticketResult.id);
        toast.error("Ticket opened, but the attachment failed to upload.", {
          description:
            error instanceof Error ? error.message : "Please try again.",
        });
        setIsCreatingTicket(false);
        return;
      }
    }

    const { error: messageError } = await supabase
      .from("ticket_messages")
      .insert({
        ticket_id: ticketResult.id,
        sender_id: user.id,
        message: initialMessage,
        attachment_name: attachmentFields.attachment_name ?? null,
        attachment_mime_type: attachmentFields.attachment_mime_type ?? null,
        attachment_storage_path:
          attachmentFields.attachment_storage_path ?? null,
      });

    if (messageError) {
      await supabase
        .from("support_tickets")
        .delete()
        .eq("id", ticketResult.id);
      toast.error("Ticket opened, but the first message failed to send.");
      setIsCreatingTicket(false);
      return;
    }

    toast.success("Support ticket created!");
    resetCreateTicketForm();
    await fetchTickets();
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !user ||
      !activeTicket ||
      (!richTextHasVisibleContent(newMessage) && !replyAttachment) ||
      isSendingMessage
    ) {
      return;
    }

    const textToSend = normalizeRichTextInput(newMessage);
    setIsSendingMessage(true);
    setNewMessage("");

    if (messageComposerRef.current) {
      messageComposerRef.current.innerHTML = "";
    }

    let attachmentFields: {
      attachment_name?: string | null;
      attachment_mime_type?: string | null;
      attachment_storage_path?: string | null;
    } = {};

    if (replyAttachment) {
      try {
        attachmentFields = await uploadTicketAttachment(
          activeTicket.id,
          replyAttachment,
        );
      } catch (error) {
        toast.error("Failed to upload attachment", {
          description:
            error instanceof Error ? error.message : "Please try again.",
        });
        setNewMessage(textToSend);
        if (messageComposerRef.current) {
          messageComposerRef.current.innerHTML = textToSend;
        }
        setIsSendingMessage(false);
        return;
      }
    }

    const { error } = await supabase
      .from("ticket_messages")
      .insert({
        ticket_id: activeTicket.id,
        sender_id: user.id,
        message: textToSend,
        attachment_name: attachmentFields.attachment_name ?? null,
        attachment_mime_type: attachmentFields.attachment_mime_type ?? null,
        attachment_storage_path:
          attachmentFields.attachment_storage_path ?? null,
      });

    if (error) {
      toast.error("Failed to send message");
      setNewMessage(textToSend);
      if (messageComposerRef.current) {
        messageComposerRef.current.innerHTML = textToSend;
      }
      setIsSendingMessage(false);
      return;
    }

    await fetchMessages(activeTicket.id);
    clearReplyAttachment();
    setIsSendingMessage(false);
  };

  const toggleTag = (value: string) => {
    setNewTags((current) => {
      const exists = current.includes(value);
      if (exists) {
        const next = current.filter((tag) => tag !== value);
        return next.length > 0 ? next : ["general"];
      }

      return [...current.filter((tag) => tag !== "general"), value];
    });
  };

  const handleAttachmentSelect = (
    file: File | null,
    target: "reply" | "create",
  ) => {
    if (!file) return;

    if (target === "reply") {
      setReplyAttachment(file);
      return;
    }

    setCreateAttachment(file);
  };

  const openSuggestedTicket = (
    subject: string,
    tags: string[],
    message?: string,
  ) => {
    const normalizedTags = tags.length > 0 ? tags : ["general"];
    const nextPrefill = message ? plainTextToEditorHtml(message) : "";

    setNewSubject(subject);
    setNewTags(normalizedTags);
    setNewBookingId("");
    setNewInitialMessage(nextPrefill);
    setPrefillCreateMessage(nextPrefill);
    setActiveTicket(null);
    setMessages([]);
    clearCreateAttachment();

    if (createMessageComposerRef.current) {
      createMessageComposerRef.current.innerHTML = nextPrefill;
    }

    setIsCreating(true);
  };

  const filteredHelpArticles = useMemo(() => {
    const query = helpQuery.trim().toLowerCase();

    return helpArticles.filter((article) => {
      const matchesCategory =
        helpFilter === "all" ? true : article.category === helpFilter;
      if (!matchesCategory) return false;
      if (!query) return true;

      const haystack = [
        article.title,
        article.question,
        article.answer,
        article.relatedTags.join(" "),
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [helpFilter, helpQuery]);

  const selectedTagLabels = useMemo(
    () => getTicketTagLabels(serializeTicketTags(newTags)),
    [newTags],
  );
  const isActiveTicketClosed = activeTicket ? activeTicket.status !== "open" : false;

  const supportTickets = useMemo(
    () => tickets.filter((ticket) => !isConversationTicket(ticket)),
    [tickets],
  );
  const conversationTickets = useMemo(
    () => tickets.filter((ticket) => isConversationTicket(ticket)),
    [tickets],
  );
  const visibleTickets =
    ticketView === "messages" ? conversationTickets : supportTickets;

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-6 animate-fade-in">
      <div className="order-1 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Help &amp; Support</h1>
          <p className="text-muted-foreground mt-1">
            Check quick answers first, then open a case if you still need help.
          </p>
        </div>
        <Button onClick={() => setIsCreating(true)} className="gap-2 shadow-lg shadow-primary/20">
          <Plus className="w-4 h-4" /> New Ticket
        </Button>
      </div>

      <div className="order-3 rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <BookOpen className="h-4 w-4 text-primary" />
              Quick answers
            </div>
            <p className="text-sm text-muted-foreground">
              These cover the questions users usually ask before opening a support ticket.
            </p>
          </div>
          <div className="w-full lg:max-w-sm">
            <Input
              value={helpQuery}
              onChange={(event) => setHelpQuery(event.target.value)}
              placeholder="Search help topics"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {helpCategories.map((category) => (
            <Button
              key={category.id}
              type="button"
              size="sm"
              variant={helpFilter === category.id ? "default" : "outline"}
              onClick={() => setHelpFilter(category.id)}
            >
              {category.label}
            </Button>
          ))}
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {filteredHelpArticles.map((article) => (
            <div
              key={article.id}
              className="rounded-xl border border-border/60 bg-muted/10 p-4"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                {helpCategories.find((entry) => entry.id === article.category)?.label ?? article.category}
              </p>
              <h2 className="mt-1 font-semibold text-foreground">{article.question}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {article.answer}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {article.relatedTags.map((tag) => (
                  <span
                    key={`${article.id}-${tag}`}
                    className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary"
                  >
                    {tag}
                  </span>
                ))}
              </div>
              <div className="mt-4">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    openSuggestedTicket(
                      `Need more help: ${article.title}`,
                      [article.suggestedTicketTag ?? "general"],
                      `I already checked the quick answer for "${article.question}", but I still need help with:\n\n`,
                    )
                  }
                >
                  This did not solve it
                </Button>
              </div>
            </div>
          ))}
        </div>

        {filteredHelpArticles.length === 0 ? (
          <div className="mt-5 rounded-xl border border-dashed border-border/60 px-4 py-6 text-sm text-muted-foreground">
            No quick answers matched that search. Open a ticket and we will help directly.
          </div>
        ) : null}
      </div>

      <div className="order-2 grid min-h-[600px] gap-6 md:h-[600px] md:grid-cols-3">
        <div className="border border-border/50 rounded-xl bg-card overflow-hidden flex flex-col">
          <div className="border-b border-border/30 bg-muted/20">
            <div className="grid grid-cols-2">
              <button
                type="button"
                onClick={() => setTicketView("support")}
                className={`px-3 py-3 text-xs font-semibold uppercase tracking-wider transition-colors ${
                  ticketView === "support"
                    ? "border-b-2 border-primary text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                SafeDrive Support
                {supportTickets.length > 0 ? ` (${supportTickets.length})` : ""}
              </button>
              <button
                type="button"
                onClick={() => setTicketView("messages")}
                className={`px-3 py-3 text-xs font-semibold uppercase tracking-wider transition-colors ${
                  ticketView === "messages"
                    ? "border-b-2 border-primary text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Lister Messages
                {conversationTickets.length > 0
                  ? ` (${conversationTickets.length})`
                  : ""}
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {loading ? (
              Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-16 w-full rounded-lg" />
              ))
            ) : visibleTickets.length === 0 ? (
              <div className="text-center py-10 opacity-60">
                <Ticket className="w-8 h-8 mx-auto mb-2" />
                <p className="text-sm">
                  {ticketView === "messages"
                    ? "No lister conversations yet"
                    : "No support tickets yet"}
                </p>
                {ticketView === "messages" ? (
                  <p className="mt-1 text-xs">
                    Start one from a car page with &ldquo;Ask the lister&rdquo;.
                  </p>
                ) : null}
              </div>
            ) : (
              visibleTickets.map((ticket) => (
                <div
                  key={ticket.id}
                  onClick={() => handleOpenTicket(ticket)}
                  className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                    activeTicket?.id === ticket.id
                      ? "border-primary bg-primary/5"
                      : "border-transparent hover:bg-muted"
                  }`}
                >
                  <p className="font-medium text-sm line-clamp-1">{ticket.subject}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {getTicketTagLabels(ticket.tag).map((label) => (
                      <span
                        key={`${ticket.id}-${label}`}
                        className="rounded bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary"
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider font-bold ${
                        ticket.status === "open"
                          ? "bg-amber-500/10 text-amber-500"
                          : "bg-green-500/10 text-green-500"
                      }`}
                    >
                      {ticket.status === "open" ? "Open" : "Resolved"}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {format(new Date(ticket.created_at), "MMM d")}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="md:col-span-2 border border-border/50 rounded-xl bg-card flex flex-col overflow-hidden">
          {activeTicket ? (
            <>
              <div className="p-4 border-b border-border/30 bg-muted/20 flex items-center justify-between">
                <div>
                  <h2 className="font-bold text-lg">{activeTicket.subject}</h2>
                  <p className="text-xs text-muted-foreground font-mono mt-0.5">
                    Ticket ID: {activeTicket.id.split("-")[0]}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-2 text-[10px]">
                    {getTicketTagLabels(activeTicket.tag).map((label) => (
                      <span
                        key={`${activeTicket.id}-${label}`}
                        className="rounded bg-primary/10 px-2 py-0.5 font-semibold text-primary"
                      >
                        {label}
                      </span>
                    ))}
                    {activeTicket.booking_id && (
                      <span className="rounded bg-muted px-2 py-0.5 font-mono text-muted-foreground">
                        Booking {activeTicket.booking_id.slice(0, 8)}
                      </span>
                    )}
                  </div>
                </div>
                {isActiveTicketClosed && (
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-green-500 bg-green-500/10 px-3 py-1 rounded-full">
                    <CheckCircle2 className="w-4 h-4" /> Resolved
                  </div>
                )}
              </div>

              <div
                ref={messagesScrollRef}
                className="flex-1 overflow-y-auto p-4 space-y-4"
              >
                {messagesLoading ? (
                  <div className="flex justify-center py-10">
                    <Clock className="w-6 h-6 animate-pulse opacity-50" />
                  </div>
                ) : (
                  messages.map((message) => {
                    const isMe = message.sender_id === user?.id;
                    const attachmentUrl = attachmentUrls[message.id] ?? null;
                    const senderProfile = senderProfiles[message.sender_id];
                    const sender = activeTicket
                      ? resolveTicketSender({
                          ticket: activeTicket,
                          senderId: message.sender_id,
                          currentUserId: user?.id,
                          senderRole: senderProfile?.role,
                          senderName: senderProfile?.full_name,
                        })
                      : { label: isMe ? "You" : "SafeDrive Support" };
                    return (
                      <div key={message.id} className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}>
                        <span className="text-[10px] text-muted-foreground mb-1 ml-1">
                          {sender.label} | {format(new Date(message.created_at), "h:mm a")}
                        </span>
                        <div
                          className={`px-4 py-2 rounded-2xl max-w-[80%] text-sm space-y-3 ${
                            isMe
                              ? "bg-primary text-primary-foreground rounded-tr-sm"
                              : "bg-muted rounded-tl-sm"
                          }`}
                        >
                          {richTextHasVisibleContent(message.message) ? (
                            <div
                              dangerouslySetInnerHTML={{
                                __html: formatRichTextForDisplay(message.message),
                              }}
                            />
                          ) : null}
                          {attachmentUrl ? (
                            isTicketAttachmentImage(message.attachment_mime_type) ? (
                              <a
                                href={attachmentUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block"
                              >
                                <img
                                  src={attachmentUrl}
                                  alt={message.attachment_name || "Ticket attachment"}
                                  className="max-h-56 rounded-lg border border-black/10 object-cover"
                                />
                              </a>
                            ) : (
                              <a
                                href={attachmentUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium ${
                                  isMe
                                    ? "border-white/20 bg-white/10"
                                    : "border-border bg-background"
                                }`}
                              >
                                <FileText className="h-4 w-4" />
                                <span>{message.attachment_name || "Attachment"}</span>
                              </a>
                            )
                          ) : null}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {!isActiveTicketClosed ? (
                <form onSubmit={handleSendMessage} className="p-3 border-t border-border/50 bg-muted/10 space-y-3">
                  <div className="flex gap-2">
                    <div
                      ref={messageComposerRef}
                      contentEditable
                      suppressContentEditableWarning
                      onInput={(event) => setNewMessage(event.currentTarget.innerHTML)}
                      data-placeholder="Type a message..."
                      className="flex-1 rounded-xl border border-input bg-background px-3 py-2 text-sm min-h-11 max-h-36 overflow-y-auto empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <input
                      ref={replyAttachmentInputRef}
                      type="file"
                      accept={ticketAttachmentAccept}
                      className="hidden"
                      onChange={(event) =>
                        handleAttachmentSelect(
                          event.target.files?.[0] ?? null,
                          "reply",
                        )
                      }
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-xl min-w-11 px-3"
                      onClick={() => replyAttachmentInputRef.current?.click()}
                    >
                      <Paperclip className="w-4 h-4" />
                    </Button>
                    <Button
                      type="submit"
                      disabled={
                        (!richTextHasVisibleContent(newMessage) &&
                          !replyAttachment) ||
                        isSendingMessage
                      }
                      className="rounded-xl shadow-md min-w-11"
                    >
                      {isSendingMessage ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                  {replyAttachment ? (
                    <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background px-3 py-2 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        {replyAttachment.type.startsWith("image/") ? (
                          <ImageIcon className="h-4 w-4 shrink-0" />
                        ) : (
                          <FileText className="h-4 w-4 shrink-0" />
                        )}
                        <span className="truncate">{replyAttachment.name}</span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={clearReplyAttachment}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : null}
                </form>
              ) : (
                <div className="p-4 text-center text-sm text-muted-foreground border-t border-border/50 bg-muted/20">
                  This support ticket is resolved and cannot receive new messages.
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground opacity-60">
              <MessageSquare className="w-12 h-12 mb-3 opacity-50" />
              <p>Select a ticket from the left to view the thread</p>
            </div>
          )}
        </div>
      </div>

      {isCreating &&
        createPortal(
        (<div className="fixed inset-0 z-[100] flex items-start sm:items-center justify-center overflow-y-auto p-4 py-6 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-background max-w-4xl w-full rounded-lg shadow-2xl overflow-hidden animate-scale-in">
            <div className="flex justify-between items-center p-5 border-b border-border/40 bg-muted/20">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <Ticket className="w-5 h-5 text-primary" /> Create Support Ticket
              </h2>
              <Button variant="ghost" size="icon" onClick={resetCreateTicketForm}>
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="p-5 space-y-5">
              <div className="grid gap-5 lg:grid-cols-[1fr_1.15fr]">
              <div className="space-y-2">
                <Label>Issue tags</Label>
                <div className="rounded-lg border border-border/50 bg-muted/10 p-3 space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {selectedTagLabels.map((label) => (
                      <span
                        key={label}
                        className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary"
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {ticketTags.map((tag) => (
                      <label
                        key={tag.value}
                        className="flex items-center gap-2 rounded-md border border-border/40 bg-background px-3 py-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={newTags.includes(tag.value)}
                          onChange={() => toggleTag(tag.value)}
                          className="h-4 w-4 rounded border-input"
                        />
                        <span>{tag.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              {newBookingId && (
                <div className="space-y-2">
                  <Label>Linked Booking</Label>
                  <Input value={newBookingId} readOnly className="font-mono text-xs" />
                </div>
              )}

              <div className="space-y-4">
              <div className="space-y-2">
                <Label>Subject Header</Label>
                <Input
                  required
                  placeholder="e.g. Issue with verifying my license"
                  value={newSubject}
                  onChange={(event) => setNewSubject(event.target.value)}
                  className="h-10"
                />
              </div>

              <div className="space-y-2">
                <Label>Describe your issue</Label>
                <div
                  ref={createMessageComposerRef}
                  contentEditable
                  suppressContentEditableWarning
                  onInput={(event) => setNewInitialMessage(event.currentTarget.innerHTML)}
                  data-placeholder="Paste or type details about your issue..."
                  className="w-full min-h-[140px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background overflow-y-auto empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <p className="text-xs text-muted-foreground">
                  Formatting from pasted text is kept when possible for clearer support messages.
                </p>
                <input
                  ref={createAttachmentInputRef}
                  type="file"
                  accept={ticketAttachmentAccept}
                  className="hidden"
                  onChange={(event) =>
                    handleAttachmentSelect(
                      event.target.files?.[0] ?? null,
                      "create",
                    )
                  }
                />
                <div className="flex items-center justify-between gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="gap-2"
                    onClick={() => createAttachmentInputRef.current?.click()}
                  >
                    <Paperclip className="h-4 w-4" />
                    Add Photo or File
                  </Button>
                  {createAttachment ? (
                    <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-background px-3 py-2 text-xs">
                      {createAttachment.type.startsWith("image/") ? (
                        <ImageIcon className="h-4 w-4" />
                      ) : (
                        <FileText className="h-4 w-4" />
                      )}
                      <span className="max-w-[180px] truncate">
                        {createAttachment.name}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={clearCreateAttachment}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>
              </div>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={resetCreateTicketForm}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => void handleCreateTicket()}
                  disabled={
                    isCreatingTicket ||
                    !newSubject.trim() ||
                    (!richTextHasVisibleContent(newInitialMessage) &&
                      !createAttachment)
                  }
                  className="shadow-lg shadow-primary/20"
                >
                  {isCreatingTicket ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    "Create Ticket"
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>),
        document.body,
      )}
    </div>
  );
}

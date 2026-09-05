import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  ImageIcon,
  Loader2,
  Lock,
  MapPin,
  MessageSquare,
  Paperclip,
  Send,
  Ticket,
  X,
  Plus,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { uploadFile } from "@/lib/uploadUtils";
import {
  adminTicketFilterTags,
  createNotification,
  getTicketAttachmentUrl,
  getTicketTagLabels,
  isConversationTicket,
  isTicketAttachmentImage,
  resolveTicketSender,
  ticketAttachmentAccept,
  ticketAttachmentBucket,
  ticketTags,
  ticketMatchesTagFilter,
} from "@/lib/supportTickets";
import {
  formatRichTextForDisplay,
  normalizeRichTextInput,
  richTextHasVisibleContent,
} from "@/lib/richText";
import { Profile, SupportTicket, TicketMessage } from "@/types/database";
import { Button } from "@/components/ui/button";
import AdminSectionTabs from "@/components/AdminSectionTabs";
import { Skeleton } from "@/components/ui/skeleton";
import ConfirmDialog from "@/components/ConfirmDialog";

type AdminTicket = SupportTicket & {
  profiles?: Pick<Profile, "full_name" | "email">;
};

type BookingArrivalEvidence = {
  id: string;
  start_date: string;
  pickup_time: string | null;
  renter_arrived_at: string | null;
  lister_arrived_at: string | null;
  renter_arrival_photo_url: string | null;
  lister_arrival_photo_url: string | null;
  renter_arrival_latitude: number | null;
  renter_arrival_longitude: number | null;
  renter_arrival_accuracy_meters: number | null;
  renter_arrival_location_captured_at: string | null;
  lister_arrival_latitude: number | null;
  lister_arrival_longitude: number | null;
  lister_arrival_accuracy_meters: number | null;
  lister_arrival_location_captured_at: string | null;
  cars?: {
    plate_number: string;
    location: string | null;
    car_models?: {
      name: string;
      car_brands?: { name: string };
    };
  } | null;
};

export default function AdminSupportTicketsPage() {
  const { user } = useAuth();
  const [tickets, setTickets] = useState<AdminTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "open" | "closed">("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [kindFilter, setKindFilter] = useState<"all" | "support" | "conversation">(
    "support",
  );

  const [activeTicket, setActiveTicket] = useState<AdminTicket | null>(null);
  const [activeBookingEvidence, setActiveBookingEvidence] =
    useState<BookingArrivalEvidence | null>(null);
  const [bookingEvidenceLoading, setBookingEvidenceLoading] = useState(false);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [senderProfiles, setSenderProfiles] = useState<
    Record<string, { full_name: string | null; role: string }>
  >({});
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [newMessage, setNewMessage] = useState("");
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [replyAttachment, setReplyAttachment] = useState<File | null>(null);
  const [users, setUsers] = useState<Array<Pick<Profile, "id" | "full_name" | "email">>>([]);
  const [showCreateTicket, setShowCreateTicket] = useState(false);
  const [createUserId, setCreateUserId] = useState("");
  const [createTag, setCreateTag] = useState("general");
  const [createSubject, setCreateSubject] = useState("");
  const [createMessage, setCreateMessage] = useState("");
  const [isCreatingTicket, setIsCreatingTicket] = useState(false);
  const messageComposerRef = useRef<HTMLDivElement | null>(null);
  const messagesScrollRef = useRef<HTMLDivElement | null>(null);
  const replyAttachmentInputRef = useRef<HTMLInputElement | null>(null);

  const logSupportAdminAction = useCallback(
    async (
      action: string,
      ticket: Pick<SupportTicket, "id" | "subject" | "booking_id" | "tag" | "user_id">,
      details?: Record<string, unknown>,
    ) => {
      if (!user) return;

      const { error } = await supabase.from("audit_log").insert({
        user_id: user.id,
        action,
        entity_type: "support_ticket",
        entity_id: ticket.id,
        details: {
          admin_email: user.email,
          ticket_subject: ticket.subject,
          booking_id: ticket.booking_id,
          tag: ticket.tag,
          affected_user_id: ticket.user_id,
          ...details,
        },
      });

      if (error) {
        console.warn(`Support audit log failed for ${action}:`, error.message);
      }
    },
    [user],
  );

  const clearReplyAttachment = () => {
    setReplyAttachment(null);
    if (replyAttachmentInputRef.current) {
      replyAttachmentInputRef.current.value = "";
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

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("support_tickets")
      .select(
          `
          *,
          profiles!support_tickets_user_id_fkey (full_name, email)
        `,
      )
      .order("created_at", { ascending: false });

    if (!error && data) {
      setTickets(data as AdminTicket[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchTickets();
  }, [fetchTickets]);

  useEffect(() => {
    const fetchUsers = async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .eq("role", "user")
        .order("created_at", { ascending: false });

      setUsers((data ?? []) as Array<Pick<Profile, "id" | "full_name" | "email">>);
    };

    void fetchUsers();
  }, []);

  useEffect(() => {
    // Scroll the message list to the bottom WITHOUT touching the page scroll
    // position (scrollIntoView would also scroll the surrounding <main>).
    const el = messagesScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const queueStats = useMemo(() => {
    const openTickets = tickets.filter((ticket) => ticket.status === "open");
    return {
      open: openTickets.length,
      noShow: openTickets.filter((ticket) => ticketMatchesTagFilter(ticket.tag, "no_show")).length,
      inquiries: openTickets.filter((ticket) => ticketMatchesTagFilter(ticket.tag, "inquiry")).length,
    };
  }, [tickets]);

  const filteredTickets = useMemo(
    () =>
      [...tickets].filter((ticket) => {
        const matchesStatus = filter === "all" ? true : ticket.status === filter;
        const matchesTag = ticketMatchesTagFilter(ticket.tag, tagFilter);
        const matchesKind =
          kindFilter === "all"
            ? true
            : kindFilter === "conversation"
              ? isConversationTicket(ticket)
              : !isConversationTicket(ticket);
        return matchesStatus && matchesTag && matchesKind;
      }).sort((left, right) => {
        const leftOpenScore = left.status === "open" ? 1 : 0;
        const rightOpenScore = right.status === "open" ? 1 : 0;
        if (leftOpenScore !== rightOpenScore) return rightOpenScore - leftOpenScore;

        const leftNoShowScore = ticketMatchesTagFilter(left.tag, "no_show") ? 1 : 0;
        const rightNoShowScore = ticketMatchesTagFilter(right.tag, "no_show") ? 1 : 0;
        if (leftNoShowScore !== rightNoShowScore) return rightNoShowScore - leftNoShowScore;

        return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
      }),
    [tickets, filter, tagFilter, kindFilter],
  );

  const conversationCount = useMemo(
    () =>
      tickets.filter(
        (ticket) => ticket.status === "open" && isConversationTicket(ticket),
      ).length,
    [tickets],
  );

  const fetchMessages = async (ticketId: string) => {
    setMessagesLoading(true);
    const { data, error } = await supabase
      .from("ticket_messages")
      .select("*")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: true });

    if (!error && data) {
      setMessages(data as TicketMessage[]);

      const senderIds = [
        ...new Set((data as TicketMessage[]).map((message) => message.sender_id)),
      ];
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
        (data as TicketMessage[])
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

  const fetchBookingEvidence = async (bookingId: string) => {
    setBookingEvidenceLoading(true);
    const baseSelect = `
      id,
      start_date,
      pickup_time,
      renter_arrived_at,
      lister_arrived_at,
      renter_arrival_photo_url,
      lister_arrival_photo_url,
      cars (
        plate_number,
        location,
        car_models (name, car_brands (name))
      )
    `;
    const locationSelect = `
      ${baseSelect},
      renter_arrival_latitude,
      renter_arrival_longitude,
      renter_arrival_accuracy_meters,
      renter_arrival_location_captured_at,
      lister_arrival_latitude,
      lister_arrival_longitude,
      lister_arrival_accuracy_meters,
      lister_arrival_location_captured_at
    `;

    const { data, error } = await supabase
      .from("bookings")
      .select(locationSelect)
      .eq("id", bookingId)
      .maybeSingle();

    if (!error && data) {
      setActiveBookingEvidence(data as BookingArrivalEvidence);
      setBookingEvidenceLoading(false);
      return;
    }

    const { data: fallbackData } = await supabase
      .from("bookings")
      .select(baseSelect)
      .eq("id", bookingId)
      .maybeSingle();

    setActiveBookingEvidence(
      fallbackData
        ? ({
            ...(fallbackData as BookingArrivalEvidence),
            renter_arrival_latitude: null,
            renter_arrival_longitude: null,
            renter_arrival_accuracy_meters: null,
            renter_arrival_location_captured_at: null,
            lister_arrival_latitude: null,
            lister_arrival_longitude: null,
            lister_arrival_accuracy_meters: null,
            lister_arrival_location_captured_at: null,
          } as BookingArrivalEvidence)
        : null,
    );
    setBookingEvidenceLoading(false);
  };

  const handleOpenTicket = (ticket: AdminTicket) => {
    setActiveTicket(ticket);
    setActiveBookingEvidence(null);
    setNewMessage("");
    clearReplyAttachment();
    if (messageComposerRef.current) {
      messageComposerRef.current.innerHTML = "";
    }
    void fetchMessages(ticket.id);
    if (ticket.booking_id) {
      void fetchBookingEvidence(ticket.booking_id);
    }
  };

  const getMapUrl = (latitude: number, longitude: number) =>
    `https://www.google.com/maps?q=${latitude},${longitude}`;

  const formatArrivalTime = (value: string | null) => {
    if (!value) return "Not recorded";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "Recorded, time unavailable";
    return format(parsed, "MMM d, yyyy h:mm a");
  };

  const formatVehicleLabel = (booking: BookingArrivalEvidence) => {
    const brand = booking.cars?.car_models?.car_brands?.name;
    const model = booking.cars?.car_models?.name;
    const plate = booking.cars?.plate_number;
    return (
      [brand, model, plate ? `(${plate})` : null].filter(Boolean).join(" ") ||
      `Booking ${booking.id.slice(0, 8)}`
    );
  };

  const renderArrivalEvidenceRow = (
    label: string,
    arrivedAt: string | null,
    photoUrl: string | null,
    latitude: number | null,
    longitude: number | null,
    accuracyMeters: number | null,
    capturedAt: string | null,
  ) => {
    const hasLocation =
      typeof latitude === "number" && typeof longitude === "number";

    return (
      <div className="rounded-xl border border-border/70 bg-background/80 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            {arrivedAt ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
            ) : (
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <div>
              <p className="text-sm font-semibold">{label}</p>
              <p className="text-xs text-muted-foreground">
                Arrival: {formatArrivalTime(arrivedAt)}
              </p>
              {capturedAt ? (
                <p className="text-xs text-muted-foreground">
                  Location captured: {formatArrivalTime(capturedAt)}
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {photoUrl ? (
              <a
                href={photoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium hover:bg-muted"
              >
                <ExternalLink className="h-3 w-3" />
                Photo
              </a>
            ) : null}
            {hasLocation ? (
              <a
                href={getMapUrl(latitude, longitude)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium hover:bg-muted"
              >
                <MapPin className="h-3 w-3" />
                Map
              </a>
            ) : null}
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {hasLocation
            ? `Optional location check stored${
                typeof accuracyMeters === "number"
                  ? `, accuracy about ${Math.round(accuracyMeters)}m`
                  : ""
              }.`
            : "No optional location check was stored for this side."}
        </p>
      </div>
    );
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

    const { data: createdMessage, error } = await supabase
      .from("ticket_messages")
      .insert({
        ticket_id: activeTicket.id,
        sender_id: user.id,
        message: textToSend,
        attachment_name: attachmentFields.attachment_name ?? null,
        attachment_mime_type: attachmentFields.attachment_mime_type ?? null,
        attachment_storage_path:
          attachmentFields.attachment_storage_path ?? null,
      })
      .select("id")
      .single();

    if (error) {
      toast.error("Failed to send message", { description: error.message });
      setNewMessage(textToSend);
      if (messageComposerRef.current) {
        messageComposerRef.current.innerHTML = textToSend;
      }
      setIsSendingMessage(false);
      return;
    }

    await logSupportAdminAction("admin_replied_support_ticket", activeTicket, {
      has_attachment: Boolean(replyAttachment),
    });

    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token && createdMessage?.id) {
      try {
        const response = await fetch("/api/send-support-ticket-reply-email", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ ticketId: activeTicket.id, messageId: createdMessage.id }),
        });
        const body = (await response.json().catch(() => ({}))) as { deliveryState?: string };
        if (body.deliveryState === "not_configured") {
          toast.warning("Reply posted, but email is not configured yet.");
        } else if (!response.ok || body.deliveryState !== "sent") {
          toast.warning("Reply posted, but the email notification was not delivered.");
        }
      } catch (emailError) {
        console.warn("Support ticket reply email request failed", emailError);
        toast.warning("Reply posted, but the email notification could not be sent.");
      }
    }

    await fetchMessages(activeTicket.id);
    clearReplyAttachment();
    setIsSendingMessage(false);
  };

  const handleCloseTicket = async () => {
    if (!activeTicket) return;

    const { error } = await supabase
      .from("support_tickets")
      .update({ status: "closed" })
      .eq("id", activeTicket.id);

    if (error) {
      toast.error("Failed to close ticket");
      return;
    }

    await createNotification({
      user_id: activeTicket.user_id,
      title: "Support ticket closed",
      message: `${activeTicket.subject} was marked as resolved by SafeDrive Support.`,
      type: "support",
      link: "/support",
    });

    await logSupportAdminAction("admin_resolved_support_ticket", activeTicket);

    toast.success("Ticket closed successfully");
    setActiveTicket({ ...activeTicket, status: "closed" });
    setShowCloseConfirm(false);
    await fetchTickets();
  };

  const handleReopenTicket = async () => {
    if (!activeTicket) return;

    const { error } = await supabase
      .from("support_tickets")
      .update({ status: "open" })
      .eq("id", activeTicket.id);

    if (error) {
      toast.error("Failed to reopen ticket");
      return;
    }

    await createNotification({
      user_id: activeTicket.user_id,
      title: "Support ticket reopened",
      message: `${activeTicket.subject} is open again and back under review by SafeDrive Support.`,
      type: "support",
      link: "/support",
    });

    await logSupportAdminAction("admin_reopened_support_ticket", activeTicket);

    toast.success("Ticket reopened successfully");
    setActiveTicket({ ...activeTicket, status: "open" });
    await fetchTickets();
  };

  const resetCreateTicket = () => {
    setShowCreateTicket(false);
    setCreateUserId("");
    setCreateTag("general");
    setCreateSubject("");
    setCreateMessage("");
  };

  const handleCreateTicketForUser = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || !createUserId || !createSubject.trim() || !richTextHasVisibleContent(createMessage)) {
      return;
    }

    setIsCreatingTicket(true);
    const { data: ticket, error: ticketError } = await supabase
      .from("support_tickets")
      .insert({
        user_id: createUserId,
        subject: createSubject.trim(),
        tag: createTag,
        status: "open",
      })
      .select("*")
      .single();

    if (ticketError || !ticket) {
      toast.error("Failed to create ticket", {
        description: ticketError?.message ?? "Please try again.",
      });
      setIsCreatingTicket(false);
      return;
    }

    const { error: messageError } = await supabase
      .from("ticket_messages")
      .insert({
        ticket_id: ticket.id,
        sender_id: user.id,
        message: normalizeRichTextInput(createMessage),
      });

    if (messageError) {
      toast.error("Ticket created, but the first message failed", {
        description: messageError.message,
      });
    } else {
      await createNotification({
        user_id: createUserId,
        title: "SafeDrive Support opened a ticket",
        message: createSubject.trim(),
        type: "support",
        link: "/support",
      });
      await logSupportAdminAction("admin_created_support_ticket", ticket, {
        created_for_user_id: createUserId,
        first_message_present: true,
      });
      toast.success("Ticket created for selected user.");
    }

    resetCreateTicket();
    await fetchTickets();
    setIsCreatingTicket(false);
  };

  const displayedBookingEvidence =
    activeTicket?.booking_id && activeBookingEvidence?.id === activeTicket.booking_id
      ? activeBookingEvidence
      : null;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Global Support Queue</h1>
          <p className="text-muted-foreground mt-1">
            Manage, respond, and resolve user support inquiries.
          </p>
        </div>
        <Button className="gap-2" onClick={() => setShowCreateTicket(true)}>
          <Plus className="h-4 w-4" />
          Create Ticket
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <AdminSectionTabs
          value={kindFilter}
          onChange={setKindFilter}
          ariaLabel="Ticket type"
          tabs={[
            { value: "support", label: "Support requests" },
            {
              value: "conversation",
              label: "Member conversations",
              count: conversationCount || undefined,
            },
            { value: "all", label: "All" },
          ]}
        />
      </div>

      {kindFilter === "conversation" ? (
        <p className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          These are renter &harr; lister conversations opened from an active booking.
          SafeDrive monitors them for safety and disputes - reply only if you need
          to step in.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <AdminSectionTabs
          value={filter}
          onChange={setFilter}
          ariaLabel="Support ticket status"
          tabs={[
            { value: "all", label: "All statuses" },
            { value: "open", label: "Open", count: queueStats.open },
            { value: "closed", label: "Closed" },
          ]}
        />
        <select
          value={tagFilter}
          onChange={(event) => setTagFilter(event.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          {adminTicketFilterTags.map((tag) => (
            <option key={tag.value} value={tag.value}>
              {tag.label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border/60 bg-card p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Ticket className="h-4 w-4 text-primary" />
            Open queue
          </div>
          <p className="mt-2 text-2xl font-bold">{queueStats.open}</p>
          <p className="text-xs text-muted-foreground">
            Support tickets still waiting for review or follow-up.
          </p>
        </div>
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <AlertTriangle className="h-4 w-4 text-red-500" />
            No-show reports
          </div>
          <p className="mt-2 text-2xl font-bold">{queueStats.noShow}</p>
          <p className="text-xs text-muted-foreground">
            Open pickup disputes that likely need faster manual review.
          </p>
        </div>
        <div className="rounded-xl border border-border/60 bg-card p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <MessageSquare className="h-4 w-4 text-primary" />
            Car inquiries
          </div>
          <p className="mt-2 text-2xl font-bold">{queueStats.inquiries}</p>
          <p className="text-xs text-muted-foreground">
            Open renter and lister inquiry threads still waiting on a response.
          </p>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-6 h-[650px]">
        <div className="border border-border/50 rounded-xl bg-card overflow-hidden flex flex-col">
          <div className="p-4 border-b border-border/30 bg-muted/20">
            <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">
              Inbox Queue
            </h3>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {loading ? (
              Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-16 w-full rounded-lg" />
              ))
            ) : filteredTickets.length === 0 ? (
              <div className="text-center py-10 opacity-60">
                <Ticket className="w-8 h-8 mx-auto mb-2" />
                <p className="text-sm">No tickets found</p>
              </div>
            ) : (
              filteredTickets.map((ticket) => (
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
                  <p className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">
                    {ticket.profiles?.full_name || ticket.profiles?.email}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {getTicketTagLabels(ticket.tag).map((label) => (
                      <span
                        key={`${ticket.id}-${label}`}
                        className={`rounded px-2 py-0.5 text-[10px] font-medium ${
                          label === "No-Show Report"
                            ? "bg-red-500/10 text-red-500"
                            : "bg-primary/10 text-primary"
                        }`}
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

        <div className="md:col-span-2 border border-border/50 rounded-xl bg-card flex flex-col overflow-hidden shadow-sm">
          {activeTicket ? (
            <>
              <div className="p-4 border-b border-border/30 bg-muted/10 flex items-center justify-between">
                <div>
                  <h2 className="font-bold text-lg">{activeTicket.subject}</h2>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-xs font-semibold px-2 py-0.5 bg-blue-500/10 text-blue-500 rounded">
                      User: {activeTicket.profiles?.full_name || activeTicket.profiles?.email}
                    </span>
                    {getTicketTagLabels(activeTicket.tag).map((label) => (
                      <span
                        key={`${activeTicket.id}-${label}`}
                        className={`text-xs font-semibold px-2 py-0.5 rounded ${
                          label === "No-Show Report"
                            ? "bg-red-500/10 text-red-500"
                            : "bg-primary/10 text-primary"
                        }`}
                      >
                        {label}
                      </span>
                    ))}
                    {activeTicket.booking_id && (
                      <span className="text-[10px] text-muted-foreground font-mono">
                        Booking: {activeTicket.booking_id.slice(0, 8)}
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground font-mono">
                      ID: {activeTicket.id.split("-")[0]}
                    </span>
                  </div>
                </div>
                {activeTicket.status === "open" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowCloseConfirm(true)}
                    className="text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950/30 gap-1.5"
                  >
                    <CheckCircle2 className="w-4 h-4" /> Resolve Ticket
                  </Button>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 text-sm font-semibold text-green-500 bg-green-500/10 px-3 py-1 rounded-full">
                      <Lock className="w-4 h-4" /> Closed
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleReopenTicket}
                      className="gap-1.5"
                    >
                      Reopen Ticket
                    </Button>
                  </div>
                )}
              </div>

              {isConversationTicket(activeTicket) ? (
                <div className="border-b border-border/40 bg-muted/30 px-4 py-3">
                  <div className="flex items-start gap-3 text-sm">
                    <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <p className="text-muted-foreground">
                      This is a <strong>renter &harr; lister conversation</strong>{" "}
                      about a booking, not a support request. SafeDrive monitors it
                      for safety and disputes - a reply here is posted as SafeDrive
                      Support and seen by both members, so only step in when needed.
                    </p>
                  </div>
                </div>
              ) : null}

              {ticketMatchesTagFilter(activeTicket.tag, "no_show") ? (
                <div className="border-b border-red-500/20 bg-red-500/5 px-4 py-3">
                  <div className="flex items-start gap-3 text-sm">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                    <div className="space-y-1">
                      <p className="font-semibold text-red-600">
                        No-show report needs timeline review
                      </p>
                      <p className="text-muted-foreground">
                        Check the arrival timestamps, any submitted pickup evidence,
                        and the linked booking context before resolving this case.
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}

              {activeTicket.booking_id ? (
                <div className="border-b border-border bg-background px-4 py-3">
                  {bookingEvidenceLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading linked booking timeline...
                    </div>
                  ) : displayedBookingEvidence ? (
                    <div className="space-y-3">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold">
                            Linked booking arrival timeline
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatVehicleLabel(displayedBookingEvidence)}
                          </p>
                        </div>
                        <div className="text-xs text-muted-foreground sm:text-right">
                          <p>
                            Pickup:{" "}
                            {formatArrivalTime(displayedBookingEvidence.start_date)}
                          </p>
                          {displayedBookingEvidence.pickup_time ? (
                            <p>Time: {displayedBookingEvidence.pickup_time}</p>
                          ) : null}
                          {displayedBookingEvidence.cars?.location ? (
                            <p>Place: {displayedBookingEvidence.cars.location}</p>
                          ) : null}
                        </div>
                      </div>

                      <div className="grid gap-3 lg:grid-cols-2">
                        {renderArrivalEvidenceRow(
                          "Renter check-in",
                          displayedBookingEvidence.renter_arrived_at,
                          displayedBookingEvidence.renter_arrival_photo_url,
                          displayedBookingEvidence.renter_arrival_latitude,
                          displayedBookingEvidence.renter_arrival_longitude,
                          displayedBookingEvidence.renter_arrival_accuracy_meters,
                          displayedBookingEvidence.renter_arrival_location_captured_at,
                        )}
                        {renderArrivalEvidenceRow(
                          "Lister check-in",
                          displayedBookingEvidence.lister_arrived_at,
                          displayedBookingEvidence.lister_arrival_photo_url,
                          displayedBookingEvidence.lister_arrival_latitude,
                          displayedBookingEvidence.lister_arrival_longitude,
                          displayedBookingEvidence.lister_arrival_accuracy_meters,
                          displayedBookingEvidence.lister_arrival_location_captured_at,
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2 text-sm text-muted-foreground">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      Linked booking timeline unavailable.
                    </div>
                  )}
                </div>
              ) : null}

              <div
                ref={messagesScrollRef}
                className="flex-1 overflow-y-auto p-4 space-y-4 bg-muted/5"
              >
                {messagesLoading ? (
                  <div className="flex justify-center py-10">
                    <Clock className="w-6 h-6 animate-pulse opacity-50" />
                  </div>
                ) : (
                  messages.map((message) => {
                    const isAdmin = message.sender_id === user?.id;
                    const attachmentUrl = attachmentUrls[message.id] ?? null;
                    const senderProfile = senderProfiles[message.sender_id];
                    const sender = resolveTicketSender({
                      ticket: activeTicket ?? { user_id: "", participant_user_id: null },
                      senderId: message.sender_id,
                      currentUserId: user?.id,
                      senderRole: senderProfile?.role,
                      senderName: senderProfile?.full_name,
                    });
                    const senderLabel = sender.kind === "you" ? "You (Admin)" : sender.label;
                    return (
                      <div key={message.id} className={`flex flex-col ${isAdmin ? "items-end" : "items-start"}`}>
                        <span className="text-[10px] text-muted-foreground mb-1 ml-1">
                          {senderLabel} | {format(new Date(message.created_at), "h:mm a")}
                        </span>
                        <div
                          className={`px-4 py-3 rounded-2xl max-w-[80%] text-sm shadow-sm space-y-3 ${
                            isAdmin
                              ? "bg-primary text-primary-foreground rounded-tr-sm"
                              : "bg-card border border-border/60 rounded-tl-sm"
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
                                  isAdmin
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

              {activeTicket.status === "open" ? (
                <form onSubmit={handleSendMessage} className="p-3 border-t border-border/50 bg-background space-y-3">
                  <div className="flex gap-2">
                    <div
                      ref={messageComposerRef}
                      contentEditable
                      suppressContentEditableWarning
                      onInput={(event) => setNewMessage(event.currentTarget.innerHTML)}
                      data-placeholder="Type official support response..."
                      className="flex-1 rounded-xl border border-input bg-background px-3 py-2 text-sm min-h-11 max-h-36 overflow-y-auto empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <input
                      ref={replyAttachmentInputRef}
                      type="file"
                      accept={ticketAttachmentAccept}
                      className="hidden"
                      onChange={(event) =>
                        setReplyAttachment(event.target.files?.[0] ?? null)
                      }
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-xl h-11 px-3"
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
                      className="rounded-xl shadow-md h-11 min-w-11 p-0"
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
                <div className="p-4 text-center text-sm text-amber-600 font-medium border-t border-border/50 bg-amber-500/5">
                  This ticket is resolved and locked for new replies.
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground opacity-60">
              <MessageSquare className="w-12 h-12 mb-3 opacity-50" />
              <p>Select a ticket to review user issues</p>
            </div>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={showCloseConfirm}
        title="Resolve this ticket?"
        description={
          activeTicket
            ? `This will close "${activeTicket.subject}" and mark it as resolved for the user.`
            : ""
        }
        confirmText="Resolve Ticket"
        onCancel={() => setShowCloseConfirm(false)}
        onConfirm={handleCloseTicket}
      />
      {showCreateTicket && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <form
            onSubmit={handleCreateTicketForUser}
            className="w-full max-w-2xl rounded-lg border border-border bg-background p-5 shadow-2xl"
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold">Create Ticket for User</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Open an official support case and notify the selected user.
                </p>
              </div>
              <Button type="button" variant="ghost" size="icon" onClick={resetCreateTicket}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">User</label>
                <select
                  required
                  value={createUserId}
                  onChange={(event) => setCreateUserId(event.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Select a user</option>
                  {users.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.full_name || profile.email} - {profile.email}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Subject</label>
                <input
                  required
                  value={createSubject}
                  onChange={(event) => setCreateSubject(event.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  placeholder="e.g. Help with verification review"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Purpose</label>
                <select
                  required
                  value={createTag}
                  onChange={(event) => setCreateTag(event.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {ticketTags.map((tag) => (
                    <option key={tag.value} value={tag.value}>
                      {tag.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Message</label>
                <div
                  contentEditable
                  suppressContentEditableWarning
                  onInput={(event) => setCreateMessage(event.currentTarget.innerHTML)}
                  data-placeholder="Write the first support message..."
                  className="min-h-32 rounded-md border border-input bg-background px-3 py-2 text-sm empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={resetCreateTicket}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  isCreatingTicket ||
                  !createUserId ||
                  !createSubject.trim() ||
                  !richTextHasVisibleContent(createMessage)
                }
              >
                {isCreatingTicket && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create Ticket
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

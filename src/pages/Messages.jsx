import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FiMessageCircle, FiSend } from 'react-icons/fi';
import toast from 'react-hot-toast';
import BackButton from '../components/BackButton';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { cx, ui } from '../lib/ui';

function Avatar({ name }) {
  return (
    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-50 text-sm font-semibold text-primary-700">
      {name?.[0]?.toUpperCase() || '?'}
    </div>
  );
}

export default function Messages() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { bookingId } = useParams();
  const bottomRef = useRef(null);

  const [conversations, setConversations] = useState([]);
  const [activeConv, setActiveConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      fetchConversations();
    }
  }, [user]);

  useEffect(() => {
    if (!activeConv) {
      return undefined;
    }

    fetchMessages(activeConv.id);
    const channel = subscribeToMessages(activeConv.id);

    return () => {
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [activeConv, user?.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchConversations = async () => {
    try {
      const { data, error } = await supabase
        .from('conversations')
        .select(
          '*, bookings(*, vehicles(make, model, thumbnail_url)), participant_one:profiles!conversations_participant_one_id_fkey(full_name, avatar_url), participant_two:profiles!conversations_participant_two_id_fkey(full_name, avatar_url)'
        )
        .or(`participant_one_id.eq.${user.id},participant_two_id.eq.${user.id}`)
        .order('last_message_at', { ascending: false });

      if (!error) {
        setConversations(data || []);

        if (bookingId) {
          const match = data?.find((conversation) => conversation.booking_id === bookingId);
          if (match) {
            setActiveConv(match);
            return;
          }
        }

        if (data?.length > 0) {
          setActiveConv(data[0]);
        }
      }
    } catch (err) {
      console.error('Conversations error:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchMessages = async (conversationId) => {
    const { data } = await supabase
      .from('messages')
      .select('*, sender:profiles!messages_sender_id_fkey(full_name, avatar_url)')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    setMessages(data || []);

    await supabase
      .from('messages')
      .update({ is_read: true })
      .eq('conversation_id', conversationId)
      .neq('sender_id', user.id);
  };

  const subscribeToMessages = (conversationId) =>
    supabase
      .channel(`messages:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          setMessages((previous) => [...previous, payload.new]);
        }
      )
      .subscribe();

  const sendMessage = async (event) => {
    event.preventDefault();
    if (!newMessage.trim() || !activeConv) {
      return;
    }

    if (newMessage.length > 1000) {
      toast.error('Message too long. Limit is 1000 characters.');
      return;
    }

    if (/<script|javascript:/i.test(newMessage)) {
      toast.error('Invalid message content');
      return;
    }

    setSending(true);
    try {
      const trimmed = newMessage.trim();

      const { error } = await supabase.from('messages').insert({
        conversation_id: activeConv.id,
        sender_id: user.id,
        content: trimmed,
        is_read: false,
      });

      if (error) {
        throw error;
      }

      await supabase
        .from('conversations')
        .update({
          last_message_at: new Date().toISOString(),
          last_message: trimmed.slice(0, 100),
        })
        .eq('id', activeConv.id);

      setConversations((previous) =>
        previous.map((conversation) =>
          conversation.id === activeConv.id
            ? {
                ...conversation,
                last_message_at: new Date().toISOString(),
                last_message: trimmed.slice(0, 100),
              }
            : conversation
        )
      );

      setNewMessage('');
    } catch {
      toast.error('Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const getOtherParticipant = (conversation) => {
    if (!conversation) {
      return null;
    }

    return conversation.participant_one_id === user.id
      ? conversation.participant_two
      : conversation.participant_one;
  };

  if (loading) {
    return (
      <div className={ui.loadingScreen}>
        <div className={ui.spinner} />
        <p className="text-sm font-medium text-text-secondary">Loading conversations...</p>
      </div>
    );
  }

  const otherParticipant = getOtherParticipant(activeConv);

  return (
    <div className={ui.pageNarrow}>
      <BackButton />

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">Inbox</p>
        <h1 className={ui.pageTitle}>Messages</h1>
        <p className={ui.pageDescription}>
          Chat directly with renters and vehicle owners inside the booking thread.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <section className={ui.section}>
          <div className={ui.sectionHeader}>
            <div>
              <h2 className="text-lg font-semibold text-text-primary">Conversations</h2>
              <p className="text-sm text-text-secondary">
                {conversations.length} active thread{conversations.length === 1 ? '' : 's'}
              </p>
            </div>
          </div>

          <div className="max-h-[640px] overflow-y-auto">
            {conversations.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <div className={ui.emptyIcon}>
                  <FiMessageCircle />
                </div>
                <p className="text-sm font-medium text-text-primary">No conversations yet</p>
                <p className="mt-2 text-sm leading-6 text-text-secondary">
                  A conversation opens automatically when a booking is created.
                </p>
              </div>
            ) : (
              conversations.map((conversation) => {
                const other = getOtherParticipant(conversation);
                const isActive = activeConv?.id === conversation.id;

                return (
                  <button
                    key={conversation.id}
                    type="button"
                    onClick={() => setActiveConv(conversation)}
                    className={cx(
                      'flex w-full items-center gap-3 border-b border-border-light px-5 py-4 text-left transition last:border-b-0 hover:bg-primary-50/40',
                      isActive && 'bg-primary-50'
                    )}
                  >
                    <Avatar name={other?.full_name} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-text-primary">
                        {other?.full_name || 'Unknown'}
                      </p>
                      <p className="truncate text-sm text-text-secondary">
                        {conversation.last_message ||
                          `${conversation.bookings?.vehicles?.make || ''} ${conversation.bookings?.vehicles?.model || ''}`.trim() ||
                          'Booking chat'}
                      </p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </section>

        <section className={cx(ui.section, 'min-h-[640px]')}>
          {activeConv ? (
            <div className="flex h-full flex-col">
              <div className={ui.sectionHeader}>
                <div className="flex items-center gap-3">
                  <Avatar name={otherParticipant?.full_name} />
                  <div>
                    <h2 className="text-lg font-semibold text-text-primary">
                      {otherParticipant?.full_name || 'Conversation'}
                    </h2>
                    <p className="text-sm text-text-secondary">
                      Re: {activeConv.bookings?.vehicles?.make} {activeConv.bookings?.vehicles?.model}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto bg-primary-50/50 px-4 py-5 sm:px-6">
                {messages.length === 0 && (
                  <div className="mx-auto mt-10 max-w-sm rounded-3xl border border-dashed border-border-light bg-surface-primary px-6 py-8 text-center">
                    <p className="text-sm font-medium text-text-primary">No messages yet</p>
                    <p className="mt-2 text-sm leading-6 text-text-secondary">
                      Start the conversation by sending a message below.
                    </p>
                  </div>
                )}

                {messages.map((message) => {
                  const isMe = message.sender_id === user.id;

                  return (
                    <div key={message.id} className={cx('flex', isMe ? 'justify-end' : 'justify-start')}>
                      <div
                        className={cx(
                          'max-w-[85%] rounded-[24px] px-4 py-3 text-sm leading-6 shadow-soft sm:max-w-[70%]',
                          isMe
                            ? 'rounded-br-md bg-primary-700 text-white'
                            : 'rounded-bl-md border border-border-light bg-surface-primary text-text-primary'
                        )}
                      >
                        <p>{message.content}</p>
                        <p
                          className={cx(
                            'mt-2 text-[11px] font-medium',
                            isMe ? 'text-primary-100' : 'text-text-tertiary'
                          )}
                        >
                          {new Date(message.created_at).toLocaleTimeString('en-PH', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                    </div>
                  );
                })}

                <div ref={bottomRef} />
              </div>

              <form onSubmit={sendMessage} className="border-t border-border-light bg-surface-primary px-4 py-4 sm:px-6">
                <div className="flex flex-col gap-3 sm:flex-row">
                  <input
                    type="text"
                    className={cx(ui.input, 'flex-1')}
                    placeholder="Type a message..."
                    value={newMessage}
                    onChange={(event) => setNewMessage(event.target.value)}
                    maxLength={1000}
                  />
                  <button
                    type="submit"
                    className={cx(ui.button.primary, 'sm:min-w-[140px]')}
                    disabled={sending || !newMessage.trim()}
                  >
                    <FiSend />
                    {sending ? 'Sending...' : 'Send'}
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-3 px-6 py-10 text-center">
              <div className={ui.emptyIcon}>
                <FiMessageCircle />
              </div>
              <h2 className="text-lg font-semibold text-text-primary">Choose a conversation</h2>
              <p className="max-w-sm text-sm leading-6 text-text-secondary">
                Pick a thread from the left to read messages and reply.
              </p>
              {bookingId && (
                <button type="button" className={ui.button.secondary} onClick={() => navigate('/bookings')}>
                  Back to bookings
                </button>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

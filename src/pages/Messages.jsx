import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { FiSend, FiArrowLeft, FiUser } from 'react-icons/fi';
import toast from 'react-hot-toast';
import BackButton from '../components/BackButton';

export default function Messages() {
    const { user, profile } = useAuth();
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
        fetchConversations();
    }, [user]);

    useEffect(() => {
        if (activeConv) {
            fetchMessages(activeConv.id);
            subscribeToMessages(activeConv.id);
        }
        return () => { supabase.removeAllChannels(); };
    }, [activeConv]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const fetchConversations = async () => {
        try {
            const { data, error } = await supabase
                .from('conversations')
                .select('*, bookings(*, vehicles(make, model, thumbnail_url)), participant_one:profiles!conversations_participant_one_id_fkey(full_name, avatar_url), participant_two:profiles!conversations_participant_two_id_fkey(full_name, avatar_url)')
                .or(`participant_one_id.eq.${user.id},participant_two_id.eq.${user.id}`)
                .order('last_message_at', { ascending: false });

            if (!error) {
                setConversations(data || []);
                if (bookingId) {
                    const match = data?.find(c => c.booking_id === bookingId);
                    if (match) setActiveConv(match);
                } else if (data?.length > 0) {
                    setActiveConv(data[0]);
                }
            }
        } catch (err) {
            console.error('Conversations error:', err);
        } finally {
            setLoading(false);
        }
    };

    const fetchMessages = async (convId) => {
        const { data } = await supabase
            .from('messages')
            .select('*, sender:profiles!messages_sender_id_fkey(full_name, avatar_url)')
            .eq('conversation_id', convId)
            .order('created_at', { ascending: true });
        setMessages(data || []);
        // Mark as read
        await supabase.from('messages').update({ is_read: true })
            .eq('conversation_id', convId)
            .neq('sender_id', user.id);
    };

    const subscribeToMessages = (convId) => {
        supabase.channel(`messages:${convId}`)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'messages',
                filter: `conversation_id=eq.${convId}`,
            }, (payload) => {
                setMessages(prev => [...prev, payload.new]);
            })
            .subscribe();
    };

    const sendMessage = async (e) => {
        e.preventDefault();
        if (!newMessage.trim() || !activeConv) return;
        // Basic XSS check
        if (newMessage.length > 1000) { toast.error('Message too long (max 1000 chars)'); return; }
        if (/<script|javascript:/i.test(newMessage)) { toast.error('Invalid message content'); return; }

        setSending(true);
        try {
            const { error } = await supabase.from('messages').insert({
                conversation_id: activeConv.id,
                sender_id: user.id,
                content: newMessage.trim(),
                is_read: false,
            });
            if (error) throw error;

            // Update conversation last_message_at
            await supabase.from('conversations').update({
                last_message_at: new Date().toISOString(),
                last_message: newMessage.trim().slice(0, 100),
            }).eq('id', activeConv.id);

            setNewMessage('');
        } catch (err) {
            toast.error('Failed to send message');
        } finally {
            setSending(false);
        }
    };

    const getOtherParticipant = (conv) => {
        if (!conv) return null;
        return conv.participant_one_id === user.id ? conv.participant_two : conv.participant_one;
    };

    if (loading) return <div className="loading-spinner"><div className="spinner" /></div>;

    return (
        <div className="max-w-[900px] mx-auto pb-6">
            <BackButton />
            <h1 className="text-[22px] font-extrabold mb-4">💬 Messages</h1>

            <div className="grid grid-cols-[280px_1fr] h-[600px] bg-[var(--surface-primary)] rounded-[var(--radius-xl)] border border-[var(--border-light)] overflow-hidden">
                {/* Conversation List */}
                <div className="border-r border-[var(--border-light)] overflow-y-auto">
                    <div className="p-4 font-bold text-[13px] text-[var(--text-tertiary)] border-b border-[var(--border-light)] uppercase tracking-wider">
                        Conversations
                    </div>
                    {conversations.length === 0 ? (
                        <div className="p-6 text-center text-[var(--text-tertiary)] text-[13px]">
                            No conversations yet. Conversations start when a booking is made.
                        </div>
                    ) : conversations.map(conv => {
                        const other = getOtherParticipant(conv);
                        const isActive = activeConv?.id === conv.id;
                        return (
                            <div key={conv.id}
                                onClick={() => setActiveConv(conv)}
                                className={`p-[14px_16px] cursor-pointer border-b border-[var(--border-light)] transition-all duration-150 ${isActive ? 'bg-[var(--primary-50)] border-l-[3px] border-l-[var(--primary-500)]' : 'bg-transparent border-l-[3px] border-l-transparent'}`}
                            >
                                <div className="flex gap-2.5 items-center">
                                    <div className="w-9 h-9 rounded-full shrink-0 bg-[var(--primary-100)] flex items-center justify-center text-[14px] font-bold text-[var(--primary-600)]">
                                        {other?.full_name?.[0]?.toUpperCase() || '?'}
                                    </div>
                                    <div className="min-w-0">
                                        <div className="font-semibold text-[13px] truncate">
                                            {other?.full_name || 'Unknown'}
                                        </div>
                                        <div className="text-[11px] text-[var(--text-tertiary)] truncate">
                                            {conv.last_message || conv.bookings?.vehicles?.make + ' ' + conv.bookings?.vehicles?.model || 'Booking chat'}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Chat Area */}
                {activeConv ? (
                    <div className="flex flex-col h-full bg-[var(--surface-primary)]">
                        {/* Chat Header */}
                        <div className="p-[14px_20px] border-b border-[var(--border-light)] flex items-center gap-3 bg-[var(--surface-secondary)]">
                            <div className="w-9 h-9 rounded-full bg-[var(--primary-100)] flex items-center justify-center text-[14px] font-bold text-[var(--primary-600)]">
                                {getOtherParticipant(activeConv)?.full_name?.[0]?.toUpperCase() || '?'}
                            </div>
                            <div>
                                <div className="font-bold">{getOtherParticipant(activeConv)?.full_name}</div>
                                <div className="text-[12px] text-[var(--text-tertiary)]">
                                    Re: {activeConv.bookings?.vehicles?.make} {activeConv.bookings?.vehicles?.model}
                                </div>
                            </div>
                        </div>

                        {/* Messages */}
                        <div className="flex-1 overflow-y-auto p-[16px_20px] flex flex-col gap-3">
                            {messages.length === 0 && (
                                <div className="text-center text-[var(--text-tertiary)] text-[13px] mt-10">
                                    No messages yet. Start the conversation!
                                </div>
                            )}
                            {messages.map(msg => {
                                const isMe = msg.sender_id === user.id;
                                return (
                                    <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                                        <div className={`max-w-[70%] p-[10px_14px] text-[14px] leading-relaxed ${isMe ? 'bg-[var(--primary-500)] text-white rounded-[16px_16px_4px_16px]' : 'bg-[var(--surface-secondary)] text-[var(--text-primary)] rounded-[16px_16px_16px_4px]'}`}>
                                            {msg.content}
                                            <div className={`text-[10px] opacity-70 mt-1 text-right ${isMe ? 'text-white' : 'text-[var(--text-tertiary)]'}`}>
                                                {new Date(msg.created_at).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                            <div ref={bottomRef} />
                        </div>

                        {/* Message Input */}
                        <form onSubmit={sendMessage} className="p-[12px_20px] border-t border-[var(--border-light)] flex gap-2.5 bg-[var(--surface-secondary)]">
                            <input
                                type="text"
                                className="form-input flex-1"
                                placeholder="Type a message..."
                                value={newMessage}
                                onChange={e => setNewMessage(e.target.value)}
                                maxLength={1000}
                            />
                            <button type="submit" className="btn btn-primary" disabled={sending || !newMessage.trim()}>
                                <FiSend />
                            </button>
                        </form>
                    </div>
                ) : (
                    <div className="flex items-center justify-center h-full text-[var(--text-tertiary)] text-[14px]">
                        Select a conversation to start messaging
                    </div>
                )}
            </div>
        </div>
    );
}

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
        <div style={{ maxWidth: 900, margin: '0 auto', paddingBottom: 24 }}>
            <BackButton />
            <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 16 }}>💬 Messages</h1>

            <div style={{
                display: 'grid', gridTemplateColumns: '280px 1fr',
                gap: 0, height: 600,
                background: 'var(--surface-primary)',
                borderRadius: 'var(--radius-xl)',
                border: '1px solid var(--border-light)',
                overflow: 'hidden',
            }}>
                {/* Conversation List */}
                <div style={{ borderRight: '1px solid var(--border-light)', overflowY: 'auto' }}>
                    <div style={{ padding: '16px', fontWeight: 700, fontSize: 13, color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border-light)' }}>
                        CONVERSATIONS
                    </div>
                    {conversations.length === 0 ? (
                        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
                            No conversations yet. Conversations start when a booking is made.
                        </div>
                    ) : conversations.map(conv => {
                        const other = getOtherParticipant(conv);
                        const isActive = activeConv?.id === conv.id;
                        return (
                            <div key={conv.id}
                                onClick={() => setActiveConv(conv)}
                                style={{
                                    padding: '14px 16px', cursor: 'pointer',
                                    background: isActive ? 'var(--primary-50)' : 'transparent',
                                    borderLeft: isActive ? '3px solid var(--primary-500)' : '3px solid transparent',
                                    borderBottom: '1px solid var(--border-light)',
                                }}>
                                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                                    <div style={{
                                        width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                                        background: 'var(--primary-100)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontSize: 14, fontWeight: 700, color: 'var(--primary-600)',
                                    }}>
                                        {other?.full_name?.[0]?.toUpperCase() || '?'}
                                    </div>
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {other?.full_name || 'Unknown'}
                                        </div>
                                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
                    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                        {/* Chat Header */}
                        <div style={{
                            padding: '14px 20px', borderBottom: '1px solid var(--border-light)',
                            display: 'flex', alignItems: 'center', gap: 12,
                            background: 'var(--surface-secondary)',
                        }}>
                            <div style={{
                                width: 36, height: 36, borderRadius: '50%',
                                background: 'var(--primary-100)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 14, fontWeight: 700, color: 'var(--primary-600)',
                            }}>
                                {getOtherParticipant(activeConv)?.full_name?.[0]?.toUpperCase() || '?'}
                            </div>
                            <div>
                                <div style={{ fontWeight: 700 }}>{getOtherParticipant(activeConv)?.full_name}</div>
                                <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                                    Re: {activeConv.bookings?.vehicles?.make} {activeConv.bookings?.vehicles?.model}
                                </div>
                            </div>
                        </div>

                        {/* Messages */}
                        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                            {messages.length === 0 && (
                                <div style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13, marginTop: 40 }}>
                                    No messages yet. Start the conversation!
                                </div>
                            )}
                            {messages.map(msg => {
                                const isMe = msg.sender_id === user.id;
                                return (
                                    <div key={msg.id} style={{ display: 'flex', justifyContent: isMe ? 'flex-end' : 'flex-start' }}>
                                        <div style={{
                                            maxWidth: '70%', padding: '10px 14px',
                                            borderRadius: isMe ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                                            background: isMe ? 'var(--primary-500)' : 'var(--surface-secondary)',
                                            color: isMe ? '#fff' : 'var(--text-primary)',
                                            fontSize: 14, lineHeight: 1.5,
                                        }}>
                                            {msg.content}
                                            <div style={{ fontSize: 10, opacity: 0.7, marginTop: 4, textAlign: 'right' }}>
                                                {new Date(msg.created_at).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                            <div ref={bottomRef} />
                        </div>

                        {/* Message Input */}
                        <form onSubmit={sendMessage} style={{
                            padding: '12px 20px', borderTop: '1px solid var(--border-light)',
                            display: 'flex', gap: 10, background: 'var(--surface-secondary)',
                        }}>
                            <input
                                type="text"
                                className="form-input"
                                style={{ flex: 1 }}
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
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-tertiary)', fontSize: 14 }}>
                        Select a conversation to start messaging
                    </div>
                )}
            </div>
        </div>
    );
}

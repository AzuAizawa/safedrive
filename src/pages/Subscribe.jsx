import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { FiCheck, FiStar, FiZap, FiList, FiToggleRight, FiCreditCard, FiShield } from 'react-icons/fi';
import { createSubscriptionPaymentLink, isSubscriptionActive, getSubscriptionDaysLeft, formatPHP, SUBSCRIPTION_PRICE, FREE_LISTING_LIMIT } from '../lib/paymongo';
import toast from 'react-hot-toast';
import BackButton from '../components/BackButton';

const FEATURES_FREE = [
    { text: '1 active vehicle listing', ok: true },
    { text: 'Rent vehicles from others', ok: true },
    { text: 'Verified identity badge', ok: true },
    { text: 'Digital rental agreements', ok: true },
    { text: 'Multiple active listings', ok: false },
    { text: 'Priority listing visibility', ok: false },
    { text: 'Premium support', ok: false },
];

const FEATURES_PRO = [
    { text: 'Unlimited active listings', ok: true },
    { text: 'Rent vehicles from others', ok: true },
    { text: 'Verified identity badge', ok: true },
    { text: 'Digital rental agreements', ok: true },
    { text: 'Priority listing visibility', ok: true },
    { text: 'Premium support', ok: true },
    { text: 'Manage vehicle availability', ok: true },
];

export default function Subscribe() {
    const { user, profile } = useAuth();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const [vehicleCount, setVehicleCount] = useState(0);

    const isActive = isSubscriptionActive(profile);
    const daysLeft = getSubscriptionDaysLeft(profile);

    useEffect(() => {
        if (user) fetchVehicleCount();
    }, [user]);

    const fetchVehicleCount = async () => {
        const { count } = await supabase.from('vehicles')
            .select('*', { count: 'exact', head: true })
            .eq('owner_id', user.id);
        setVehicleCount(count || 0);
    };

    const handleSubscribe = async () => {
        if (!user) { navigate('/login'); return; }
        setLoading(true);
        try {
            const { url } = await createSubscriptionPaymentLink(user.id, user.email);
            if (url) {
                window.location.href = url;
            } else {
                throw new Error('Payment link could not be created');
            }
        } catch (err) {
            toast.error(err.message || 'Could not start payment. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ maxWidth: 860, margin: '0 auto', paddingBottom: 48 }}>
            <BackButton />

            <div className="page-header" style={{ textAlign: 'center', marginBottom: 8 }}>
                <h1>⭐ SafeDrive Premium</h1>
                <p>List as many vehicles as you want. One affordable monthly subscription.</p>
            </div>

            {/* Active Subscription Banner */}
            {isActive && (
                <div style={{
                    background: 'linear-gradient(135deg, var(--success-50), var(--success-100))',
                    border: '2px solid var(--success-300)',
                    borderRadius: 'var(--radius-xl)',
                    padding: '20px 28px',
                    marginBottom: 28,
                    display: 'flex', alignItems: 'center', gap: 16,
                }}>
                    <span style={{ fontSize: 36 }}>🎉</span>
                    <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 800, fontSize: 17, color: 'var(--success-800)' }}>
                            You have SafeDrive Premium!
                        </div>
                        <div style={{ fontSize: 14, color: 'var(--success-700)', marginTop: 4 }}>
                            {daysLeft} days remaining — expires {new Date(profile.subscription_end_date).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })}
                        </div>
                    </div>
                    <button className="btn btn-sm" style={{ background: 'var(--success-600)', color: '#fff', border: 'none', whiteSpace: 'nowrap' }}
                        onClick={handleSubscribe} disabled={loading}>
                        Renew Early
                    </button>
                </div>
            )}

            {/* Plans */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 32 }}>
                {/* Free Plan */}
                <div style={{
                    background: 'var(--surface-primary)',
                    border: '2px solid var(--border-light)',
                    borderRadius: 'var(--radius-xl)',
                    padding: 28, position: 'relative',
                }}>
                    <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 4 }}>Free</div>
                    <div style={{ fontSize: 36, fontWeight: 900, fontFamily: 'var(--font-display)', marginBottom: 4 }}>₱0</div>
                    <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 20 }}>Forever free</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
                        {FEATURES_FREE.map((f, i) => (
                            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 14, opacity: f.ok ? 1 : 0.4 }}>
                                <FiCheck style={{ color: f.ok ? 'var(--success-500)' : 'var(--neutral-400)', flexShrink: 0 }} />
                                <span style={{ textDecoration: f.ok ? 'none' : 'line-through' }}>{f.text}</span>
                            </div>
                        ))}
                    </div>
                    {!isActive && (
                        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', background: 'var(--neutral-50)', borderRadius: 'var(--radius-md)', padding: '8px 12px' }}>
                            ✓ Your current plan
                        </div>
                    )}
                </div>

                {/* Premium Plan */}
                <div style={{
                    background: 'linear-gradient(145deg, #1e3a5f, #1a2e4a)',
                    border: '2px solid var(--primary-400)',
                    borderRadius: 'var(--radius-xl)',
                    padding: 28, position: 'relative', color: '#fff',
                    boxShadow: '0 8px 32px rgba(59,130,246,0.25)',
                }}>
                    <div style={{
                        position: 'absolute', top: 16, right: 16,
                        background: 'var(--primary-400)', color: '#fff',
                        fontSize: 11, fontWeight: 800, padding: '4px 10px',
                        borderRadius: 'var(--radius-sm)', textTransform: 'uppercase',
                    }}>Most Popular</div>
                    <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 4, color: '#e2e8f0' }}>Premium</div>
                    <div style={{ fontSize: 36, fontWeight: 900, fontFamily: 'var(--font-display)', marginBottom: 2 }}>
                        {formatPHP(SUBSCRIPTION_PRICE)}
                    </div>
                    <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 20 }}>per month · via GCash</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
                        {FEATURES_PRO.map((f, i) => (
                            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 14 }}>
                                <FiCheck style={{ color: '#4ade80', flexShrink: 0 }} />
                                <span>{f.text}</span>
                            </div>
                        ))}
                    </div>
                    {isActive ? (
                        <div style={{ fontSize: 12, background: 'rgba(74,222,128,0.15)', borderRadius: 'var(--radius-md)', padding: '8px 12px', color: '#4ade80', fontWeight: 700 }}>
                            ✓ Active — {daysLeft} days remaining
                        </div>
                    ) : (
                        <button
                            className="btn"
                            style={{
                                width: '100%', fontSize: 15, fontWeight: 700, padding: '12px 0',
                                background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                                color: '#fff', border: 'none',
                                boxShadow: '0 4px 14px rgba(37,99,235,0.4)',
                            }}
                            onClick={handleSubscribe}
                            disabled={loading}
                        >
                            {loading ? 'Redirecting to GCash...' : '💳 Subscribe via GCash'}
                        </button>
                    )}
                </div>
            </div>

            {/* How it works */}
            <div style={{
                background: 'var(--surface-primary)',
                border: '1px solid var(--border-light)',
                borderRadius: 'var(--radius-xl)',
                padding: '24px 28px', marginBottom: 24,
            }}>
                <h3 style={{ fontWeight: 700, marginBottom: 16 }}>📋 How Listings Work</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
                    {[
                        { icon: <FiList />, title: 'Free Tier', desc: `You can have up to ${FREE_LISTING_LIMIT} active vehicle listing at a time. Additional vehicles you add will be inactive — you choose which one is active.` },
                        { icon: <FiStar />, title: 'Premium Tier', desc: 'Subscribe for ₱399/month to activate unlimited listings simultaneously. All your vehicles stay active automatically.' },
                        { icon: <FiToggleRight />, title: 'Manual Control', desc: 'You can always toggle any listing on or off. Free users can have exactly 1 active at a time; subscribers can have all active.' },
                    ].map((item, i) => (
                        <div key={i} style={{ padding: 16, background: 'var(--surface-secondary)', borderRadius: 'var(--radius-md)' }}>
                            <div style={{ fontSize: 20, color: 'var(--primary-500)', marginBottom: 8 }}>{item.icon}</div>
                            <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 14 }}>{item.title}</div>
                            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{item.desc}</div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Payment Security Note */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, fontSize: 13, color: 'var(--text-tertiary)', padding: '0 4px' }}>
                <FiShield style={{ flexShrink: 0, marginTop: 1, color: 'var(--primary-400)' }} />
                <div>
                    Payment is securely processed by <strong>PayMongo</strong> — a BSP-regulated payment gateway. You'll be redirected to your GCash app to authorize the ₱399 payment. SafeDrive does not store your card or account information. Subscription is valid for 30 days from payment date.
                </div>
            </div>
        </div>
    );
}

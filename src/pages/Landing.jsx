import { FiShield, FiCheckCircle, FiStar, FiUsers, FiTruck, FiFileText } from 'react-icons/fi';
import { Link } from 'react-router-dom';

export default function Landing() {
    return (
        <div>
            {/* Hero Section */}
            <section className="landing-hero">
                <div className="landing-hero-grid" />
                <div className="floating-shape" style={{ width: 300, height: 300, background: 'rgba(59, 130, 246, 0.15)', top: '20%', left: '10%' }} />
                <div className="floating-shape" style={{ width: 200, height: 200, background: 'rgba(249, 115, 22, 0.1)', bottom: '20%', right: '20%', animationDelay: '-5s' }} />

                <div className="landing-hero-content">
                    <div className="landing-hero-text">
                        <h1>
                            Rent Cars with<br />
                            <span className="highlight">Complete Trust</span><br />
                            & Security
                        </h1>
                        <p>
                            SafeDrive is the Philippines' first identity-verified peer-to-peer car rental platform.
                            Every user is verified, every transaction is protected, and every rental is backed by a digital agreement.
                        </p>
                        <div className="landing-hero-actions">
                            <Link to="/register" className="btn btn-accent btn-lg">Start Renting Now</Link>
                            <Link to="/register?role=owner" className="btn btn-secondary btn-lg" style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: 'white' }}>
                                List Your Car
                            </Link>
                        </div>

                        <div style={{ display: 'flex', gap: 32, marginTop: 48 }}>
                            {[
                                { num: '500+', label: 'Verified Users' },
                                { num: '200+', label: 'Listed Vehicles' },
                                { num: '99%', label: 'Safe Transactions' },
                            ].map((stat, i) => (
                                <div key={i} style={{ color: 'white' }}>
                                    <div style={{ fontSize: 28, fontWeight: 800, fontFamily: 'var(--font-display)' }}>{stat.num}</div>
                                    <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>{stat.label}</div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="landing-hero-visual">
                        <div className="landing-hero-card">
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                    <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(34, 197, 94, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        <FiCheckCircle style={{ color: '#22c55e', fontSize: 20 }} />
                                    </div>
                                    <div>
                                        <div style={{ color: 'white', fontWeight: 600, fontSize: 14 }}>Identity Verified ✓</div>
                                        <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>Government ID + Selfie matched</div>
                                    </div>
                                </div>

                                <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 12, padding: 16 }}>
                                    <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Vehicle Available</div>
                                    <div style={{ color: 'white', fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-display)' }}>2024 Toyota Vios</div>
                                    <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, marginTop: 4 }}>Sedan • Automatic • Quezon City</div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                                        <div>
                                            <span style={{ color: 'var(--accent-400)', fontSize: 22, fontWeight: 800 }}>₱2,500</span>
                                            <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>/day</span>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#facc15' }}>
                                            <FiStar style={{ fill: '#facc15' }} />
                                            <span style={{ color: 'white', fontWeight: 600, fontSize: 14 }}>4.9</span>
                                        </div>
                                    </div>
                                </div>

                                <div style={{ background: 'rgba(59, 130, 246, 0.1)', borderRadius: 12, padding: 16, border: '1px solid rgba(59, 130, 246, 0.2)' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--primary-300)', fontSize: 13, fontWeight: 600 }}>
                                        <FiFileText /> Digital Agreement Ready
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Features Section */}
            <section className="landing-section" style={{ background: 'var(--surface-secondary)' }}>
                <div className="landing-section-header">
                    <div className="overline">Why SafeDrive?</div>
                    <h2>Built for Trust & Safety</h2>
                    <p>We eliminate the risks of peer-to-peer car rental through strict verification, digital contracts, and community accountability.</p>
                </div>

                <div className="features-grid">
                    <div className="feature-card">
                        <div className="feature-card-icon"><FiShield /></div>
                        <h3>Identity Verification</h3>
                        <p>Every user is verified through government-issued IDs (Driver's License & National ID via LTMS/PhilSys) and real-time selfie matching to prevent fraud.</p>
                    </div>
                    <div className="feature-card">
                        <div className="feature-card-icon"><FiFileText /></div>
                        <h3>Digital Rental Agreements</h3>
                        <p>Automatically generated digital contracts that formally document the terms, conditions, and responsibilities between car owners and renters.</p>
                    </div>
                    <div className="feature-card">
                        <div className="feature-card-icon"><FiUsers /></div>
                        <h3>Community Trust System</h3>
                        <p>Comprehensive feedback and review system for both renters and car owners, building accountability and transparency within the community.</p>
                    </div>
                </div>
            </section>

            {/* How It Works */}
            <section className="landing-section">
                <div className="landing-section-header">
                    <div className="overline">How It Works</div>
                    <h2>Simple & Secure Process</h2>
                    <p>From registration to returning the keys, every step is designed to protect both parties.</p>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 24 }}>
                    {[
                        { step: '01', title: 'Register & Verify', desc: 'Create your account and verify your identity with government ID and selfie verification.', icon: '🛡️' },
                        { step: '02', title: 'Browse & Book', desc: 'Search for verified vehicles by type, location, price and availability. Book with confidence.', icon: '🔍' },
                        { step: '03', title: 'Sign Agreement', desc: 'A digital rental agreement is automatically generated with all terms and conditions.', icon: '📄' },
                        { step: '04', title: 'Drive & Review', desc: 'Pick up the vehicle after physical ID check. After return, leave a review for the community.', icon: '⭐' },
                    ].map((item, i) => (
                        <div key={i} style={{ textAlign: 'center', padding: 24 }}>
                            <div style={{ fontSize: 40, marginBottom: 16 }}>{item.icon}</div>
                            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-500)', marginBottom: 8, letterSpacing: 2 }}>STEP {item.step}</div>
                            <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 8, fontFamily: 'var(--font-display)' }}>{item.title}</h3>
                            <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.7 }}>{item.desc}</p>
                        </div>
                    ))}
                </div>
            </section>

            {/* Vehicle Types */}
            <section className="landing-section" style={{ background: 'var(--surface-secondary)' }}>
                <div className="landing-section-header">
                    <div className="overline">Vehicle Categories</div>
                    <h2>Quality Vehicles Only</h2>
                    <p>We only accept vehicles that are 0-5 years old, ensuring reliability, safety, and roadworthiness.</p>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 24 }}>
                    {[
                        { type: 'Sedan', desc: 'Compact and fuel-efficient for city driving', emoji: '🚗' },
                        { type: 'SUV', desc: 'Spacious and rugged for any terrain', emoji: '🚙' },
                        { type: 'MPV', desc: 'Perfect for family trips and group travel', emoji: '🚐' },
                        { type: 'Van', desc: 'Maximum capacity for large groups', emoji: '🚌' },
                    ].map((v, i) => (
                        <div key={i} className="card" style={{ textAlign: 'center', padding: 32, cursor: 'pointer' }}>
                            <div style={{ fontSize: 48, marginBottom: 16 }}>{v.emoji}</div>
                            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, fontFamily: 'var(--font-display)' }}>{v.type}</h3>
                            <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{v.desc}</p>
                        </div>
                    ))}
                </div>
            </section>

            {/* CTA Section */}
            <section style={{ padding: '100px 32px', background: 'linear-gradient(135deg, var(--primary-900), var(--primary-800))', textAlign: 'center' }}>
                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 40, fontWeight: 800, color: 'white', marginBottom: 16 }}>
                    Ready to Drive Safely?
                </h2>
                <p style={{ fontSize: 17, color: 'rgba(255,255,255,0.6)', marginBottom: 32, maxWidth: 500, margin: '0 auto 32px' }}>
                    Join the SafeDrive community today and experience the most secure peer-to-peer car rental platform in the Philippines.
                </p>
                <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
                    <Link to="/register" className="btn btn-accent btn-lg">Create Free Account</Link>
                    <Link to="/register?role=owner" className="btn btn-secondary btn-lg" style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: 'white' }}>
                        List Your Vehicle
                    </Link>
                </div>
            </section>

            {/* Footer */}
            <footer className="footer">
                <div className="footer-content">
                    <div className="footer-brand">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                            <div className="navbar-logo" style={{ width: 36, height: 36, fontSize: 14 }}>SD</div>
                            <span style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, color: 'white' }}>SafeDrive</span>
                        </div>
                        <p>The Philippines' first identity-verified peer-to-peer car rental community platform. Built for trust, designed for safety.</p>
                    </div>
                    <div className="footer-section">
                        <h4>Platform</h4>
                        <a href="#">Browse Cars</a>
                        <a href="#">List Your Car</a>
                        <a href="#">How It Works</a>
                        <a href="#">Pricing</a>
                    </div>
                    <div className="footer-section">
                        <h4>Company</h4>
                        <a href="#">About Us</a>
                        <a href="#">Safety</a>
                        <a href="#">Contact</a>
                        <a href="#">FAQs</a>
                    </div>
                    <div className="footer-section">
                        <h4>Legal</h4>
                        <a href="#">Terms of Service</a>
                        <a href="#">Privacy Policy</a>
                        <a href="#">Rental Agreement</a>
                        <a href="#">Data Protection</a>
                    </div>
                </div>
                <div className="footer-bottom">
                    <span>&copy; 2026 SafeDrive. All rights reserved.</span>
                    <span>STI College Novaliches - Capstone Project</span>
                </div>
            </footer>
        </div>
    );
}

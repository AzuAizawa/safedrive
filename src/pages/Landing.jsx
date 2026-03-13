import { FiShield, FiCheckCircle, FiStar, FiUsers, FiTruck, FiFileText } from 'react-icons/fi';
import { Link } from 'react-router-dom';

export default function Landing() {
    return (
        <div>
            {/* Hero Section */}
            <section className="landing-hero">
                <div className="landing-hero-grid" />
                <div className="floating-shape w-[300px] h-[300px] bg-blue-500/15 top-[20%] left-[10%]" />
                <div className="floating-shape w-[200px] h-[200px] bg-orange-500/10 bottom-[20%] right-[20%] [animation-delay:-5s]" />

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
                            <Link to="/register?role=owner" className="btn btn-secondary btn-lg bg-white/10 border border-white/20 text-white">
                                List Your Car
                            </Link>
                        </div>

                        <div className="flex gap-8 mt-12">
                            {[
                                { num: '500+', label: 'Verified Users' },
                                { num: '200+', label: 'Listed Vehicles' },
                                { num: '99%', label: 'Safe Transactions' },
                            ].map((stat, i) => (
                                <div key={i} className="text-white">
                                    <div className="text-[28px] font-extrabold font-[var(--font-display)]">{stat.num}</div>
                                    <div className="text-[13px] text-white/50">{stat.label}</div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="landing-hero-visual">
                        <div className="landing-hero-card">
                            <div className="flex flex-col gap-5">
                                <div className="flex items-center gap-3">
                                    <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
                                        <FiCheckCircle className="text-[#22c55e] text-[20px]" />
                                    </div>
                                    <div>
                                        <div className="text-white font-semibold text-sm">Identity Verified ✓</div>
                                        <div className="text-white/50 text-[12px]">Government ID + Selfie matched</div>
                                    </div>
                                </div>

                                <div className="bg-white/5 rounded-xl p-4">
                                    <div className="text-white/50 text-[11px] uppercase tracking-wider mb-2">Vehicle Available</div>
                                    <div className="text-white text-[18px] font-bold font-[var(--font-display)]">2024 Toyota Vios</div>
                                    <div className="text-white/40 text-[13px] mt-1">Sedan • Automatic • Quezon City</div>
                                    <div className="flex justify-between items-center mt-3">
                                        <div>
                                            <span className="text-[var(--accent-400)] text-[22px] font-extrabold">₱2,500</span>
                                            <span className="text-white/40 text-[13px]">/day</span>
                                        </div>
                                        <div className="flex items-center gap-1 text-[#facc15]">
                                            <FiStar className="fill-[#facc15]" />
                                            <span className="text-white font-semibold text-sm">4.9</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-blue-500/10 rounded-xl p-4 border border-blue-500/20">
                                    <div className="flex items-center gap-2 text-[var(--primary-300)] text-[13px] font-semibold">
                                        <FiFileText /> Digital Agreement Ready
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Features Section */}
            <section className="landing-section bg-[var(--surface-secondary)]">
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

                <div className="grid grid-cols-4 gap-6">
                    {[
                        { step: '01', title: 'Register & Verify', desc: 'Create your account and verify your identity with government ID and selfie verification.', icon: '🛡️' },
                        { step: '02', title: 'Browse & Book', desc: 'Search for verified vehicles by type, location, price and availability. Book with confidence.', icon: '🔍' },
                        { step: '03', title: 'Sign Agreement', desc: 'A digital rental agreement is automatically generated with all terms and conditions.', icon: '📄' },
                        { step: '04', title: 'Drive & Review', desc: 'Pick up the vehicle after physical ID check. After return, leave a review for the community.', icon: '⭐' },
                    ].map((item, i) => (
                        <div key={i} className="text-center p-6">
                            <div className="text-[40px] mb-4">{item.icon}</div>
                            <div className="text-[12px] font-bold text-[var(--accent-500)] mb-2 tracking-[2px]">STEP {item.step}</div>
                            <h3 className="text-[17px] font-bold mb-2 font-[var(--font-display)]">{item.title}</h3>
                            <p className="text-[14px] text-[var(--text-secondary)] leading-[1.7]">{item.desc}</p>
                        </div>
                    ))}
                </div>
            </section>

            {/* Vehicle Types */}
            <section className="landing-section bg-[var(--surface-secondary)]">
                <div className="landing-section-header">
                    <div className="overline">Vehicle Categories</div>
                    <h2>Quality Vehicles Only</h2>
                    <p>We only accept vehicles that are 0-5 years old, ensuring reliability, safety, and roadworthiness.</p>
                </div>

                <div className="grid grid-cols-4 gap-6">
                    {[
                        { type: 'Sedan', desc: 'Compact and fuel-efficient for city driving', emoji: '🚗' },
                        { type: 'SUV', desc: 'Spacious and rugged for any terrain', emoji: '🚙' },
                        { type: 'MPV', desc: 'Perfect for family trips and group travel', emoji: '🚐' },
                        { type: 'Van', desc: 'Maximum capacity for large groups', emoji: '🚌' },
                    ].map((v, i) => (
                        <div key={i} className="card text-center p-8 cursor-pointer">
                            <div className="text-[48px] mb-4">{v.emoji}</div>
                            <h3 className="text-[18px] font-bold mb-2 font-[var(--font-display)]">{v.type}</h3>
                            <p className="text-[14px] text-[var(--text-secondary)]">{v.desc}</p>
                        </div>
                    ))}
                </div>
            </section>

            {/* CTA Section */}
            <section className="px-8 py-[100px] bg-gradient-to-br from-[var(--primary-900)] to-[var(--primary-800)] text-center">
                <h2 className="font-[var(--font-display)] text-[40px] font-extrabold text-white mb-4">
                    Ready to Drive Safely?
                </h2>
                <p className="text-[17px] text-white/60 mb-8 max-w-[500px] mx-auto">
                    Join the SafeDrive community today and experience the most secure peer-to-peer car rental platform in the Philippines.
                </p>
                <div className="flex gap-4 justify-center">
                    <Link to="/register" className="btn btn-accent btn-lg">Create Free Account</Link>
                    <Link to="/register?role=owner" className="btn btn-secondary btn-lg bg-white/10 border border-white/20 text-white">
                        List Your Vehicle
                    </Link>
                </div>
            </section>

            {/* Footer */}
            <footer className="footer">
                <div className="footer-content">
                    <div className="footer-brand">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="navbar-logo w-9 h-9 text-[14px]">SD</div>
                            <span className="font-[var(--font-display)] text-[20px] font-bold text-white">SafeDrive</span>
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

import { Link } from 'react-router-dom';
import { FiCheckCircle, FiFileText, FiShield, FiStar, FiUsers } from 'react-icons/fi';
import { ui } from '../lib/ui';

const steps = [
    { title: 'Create your account', copy: 'Register once, then verify your identity inside SafeDrive before you book or list.' },
    { title: 'Browse or switch to lister mode', copy: 'Use renter mode to discover cars, or switch to lister mode to manage your own inventory.' },
    { title: 'Book with clarity', copy: 'See pricing, dates, owner details, and agreement access in one consistent flow.' },
    { title: 'Manage the full trip', copy: 'Messages, bookings, and agreements stay tied together through the entire rental.' },
];

export default function Landing() {
    return (
        <div className="overflow-hidden bg-surface-secondary pt-28">
            <section className="px-4 pb-20 sm:px-6 lg:px-8">
                <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
                    <div className="space-y-7">
                        <div className="inline-flex items-center rounded-full border border-primary-100 bg-primary-50 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-primary-700">
                            Trusted peer-to-peer rentals
                        </div>
                        <div className="space-y-5">
                            <h1 className="max-w-3xl font-display text-5xl font-bold leading-[1.05] tracking-tight text-text-primary sm:text-6xl">
                                Rent and list cars with a calmer, safer workflow.
                            </h1>
                            <p className="max-w-2xl text-base leading-8 text-text-secondary">
                                SafeDrive pairs verified users, clear booking details, and mode-based renter or lister experiences so the marketplace feels organized from first browse to final handoff.
                            </p>
                        </div>
                        <div className="flex flex-col gap-3 sm:flex-row">
                            <Link to="/register" className={ui.button.accent}>
                                Start renting
                            </Link>
                            <Link to="/register" className={ui.button.secondary}>
                                Create a lister account
                            </Link>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-3">
                            {[
                                { value: '500+', label: 'Verified members' },
                                { value: '200+', label: 'Live vehicles' },
                                { value: '24/7', label: 'Booking visibility' },
                            ].map((item) => (
                                <div key={item.label} className="rounded-3xl border border-border-light bg-surface-primary px-5 py-4 shadow-soft">
                                    <div className="font-display text-3xl font-bold text-text-primary">{item.value}</div>
                                    <div className="mt-1 text-sm text-text-tertiary">{item.label}</div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="relative">
                        <div className="relative rounded-[36px] border border-border-light bg-surface-primary p-6 shadow-float sm:p-8">
                            <div className="mb-6 flex items-center justify-between rounded-3xl border border-border-light bg-surface-secondary px-5 py-4">
                                <div>
                                    <div className="text-sm font-semibold text-text-primary">SafeDrive renter flow</div>
                                    <div className="text-xs text-text-tertiary">Browse, book, and review with confidence</div>
                                </div>
                                <span className="inline-flex items-center gap-2 rounded-full bg-success-50 px-3 py-1 text-xs font-semibold text-success-700">
                                    <FiCheckCircle />
                                    Verified
                                </span>
                            </div>

                            <div className="space-y-4">
                                <div className="rounded-[30px] border border-border-light bg-surface-primary p-5 shadow-soft">
                                    <div className="mb-2 flex items-center justify-between">
                                        <div className="text-sm font-semibold text-text-primary">2024 Toyota Vios</div>
                                        <div className="flex items-center gap-1 text-sm font-semibold text-warning-600">
                                            <FiStar className="fill-current" />
                                            4.9
                                        </div>
                                    </div>
                                    <p className="text-sm text-text-secondary">Automatic · Quezon City · Verified owner</p>
                                    <div className="mt-4 flex items-end justify-between">
                                        <div>
                                            <div className="font-display text-3xl font-bold text-text-primary">PHP 2,500</div>
                                            <div className="text-xs text-text-tertiary">per day</div>
                                        </div>
                                        <div className="rounded-full bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700">
                                            Available this week
                                        </div>
                                    </div>
                                </div>

                                <div className="grid gap-4 sm:grid-cols-2">
                                    <div className="rounded-3xl border border-border-light bg-surface-primary p-5 shadow-soft">
                                        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-50 text-primary-700">
                                            <FiShield />
                                        </div>
                                        <div className="font-semibold text-text-primary">Identity verification</div>
                                        <p className="mt-2 text-sm leading-6 text-text-secondary">
                                            Verified users unlock renter and lister actions only after profile review.
                                        </p>
                                    </div>
                                    <div className="rounded-3xl border border-border-light bg-surface-primary p-5 shadow-soft">
                                        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-accent-50 text-accent-600">
                                            <FiFileText />
                                        </div>
                                        <div className="font-semibold text-text-primary">Digital agreements</div>
                                        <p className="mt-2 text-sm leading-6 text-text-secondary">
                                            Booking details, agreements, and messages stay connected inside one flow.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <section className="px-4 pb-20 sm:px-6 lg:px-8">
                <div className="mx-auto max-w-7xl rounded-[40px] border border-border-light bg-surface-primary p-6 shadow-soft sm:p-8 lg:p-10">
                    <div className="mb-8 max-w-2xl space-y-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
                            Why SafeDrive
                        </div>
                        <h2 className="font-display text-4xl font-bold tracking-tight text-text-primary">
                            A marketplace shaped around trust and role clarity.
                        </h2>
                        <p className="text-sm leading-7 text-text-secondary sm:text-base">
                            The redesign focuses on cleaner task separation: renter mode for discovery and trip management, lister mode for fleet and booking operations.
                        </p>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-3">
                        {[
                            {
                                title: 'Verified community',
                                copy: 'Identity review is built into the platform before users can transact.',
                                icon: FiShield,
                            },
                            {
                                title: 'Clear booking context',
                                copy: 'Vehicle, dates, owner or customer details, amount, and status are always visible together.',
                                icon: FiUsers,
                            },
                            {
                                title: 'Mode-aware workflow',
                                copy: 'Switch between renter and lister views without mixing the wrong actions into the wrong interface.',
                                icon: FiFileText,
                            },
                        ].map((item) => (
                            <article key={item.title} className="rounded-[32px] border border-border-light bg-surface-secondary p-6 shadow-soft">
                                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-50 text-primary-700">
                                    <item.icon />
                                </div>
                                <h3 className="font-display text-2xl font-semibold text-text-primary">{item.title}</h3>
                                <p className="mt-3 text-sm leading-7 text-text-secondary">{item.copy}</p>
                            </article>
                        ))}
                    </div>
                </div>
            </section>

            <section className="px-4 pb-20 sm:px-6 lg:px-8">
                <div className="mx-auto max-w-7xl">
                    <div className="mb-8 max-w-2xl space-y-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
                            How it works
                        </div>
                        <h2 className="font-display text-4xl font-bold tracking-tight text-text-primary">
                            Four clear steps from account creation to the road.
                        </h2>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-4">
                        {steps.map((step, index) => (
                            <article key={step.title} className="rounded-[32px] border border-border-light bg-surface-primary p-6 shadow-soft">
                                <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary-700">
                                    Step {String(index + 1).padStart(2, '0')}
                                </div>
                                <h3 className="font-display text-2xl font-semibold text-text-primary">
                                    {step.title}
                                </h3>
                                <p className="mt-3 text-sm leading-7 text-text-secondary">{step.copy}</p>
                            </article>
                        ))}
                    </div>
                </div>
            </section>

            <section className="border-t border-border-light bg-primary-900 px-4 py-16 text-white sm:px-6 lg:px-8">
                <div className="mx-auto flex max-w-7xl flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
                    <div className="max-w-2xl space-y-3">
                        <h2 className="font-display text-4xl font-bold tracking-tight">
                            Ready to move through bookings with less friction?
                        </h2>
                        <p className="text-sm leading-7 text-white/70 sm:text-base">
                            Start as a renter today, then switch to lister mode whenever you are ready to put a vehicle on the platform.
                        </p>
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row">
                        <Link to="/register" className={ui.button.accent}>
                            Create your account
                        </Link>
                        <Link to="/vehicles" className={ui.button.secondary}>
                            Browse vehicles
                        </Link>
                    </div>
                </div>
            </section>
        </div>
    );
}

export function cx(...classes) {
  return classes.filter(Boolean).join(' ');
}

const buttonBase =
  'inline-flex items-center justify-center gap-2 rounded-full border px-4 py-2.5 text-sm font-semibold transition duration-200 disabled:cursor-not-allowed disabled:opacity-50';

export const ui = {
  page: 'mx-auto w-full max-w-7xl space-y-6',
  pageNarrow: 'mx-auto w-full max-w-5xl space-y-6',
  pageCompact: 'mx-auto w-full max-w-3xl space-y-6',
  pageHeader: 'space-y-2',
  pageTitle: 'font-display text-3xl font-bold tracking-tight text-text-primary sm:text-4xl',
  pageDescription: 'max-w-3xl text-sm leading-6 text-text-secondary sm:text-base',
  section:
    'overflow-hidden rounded-3xl border border-border-light bg-surface-primary shadow-soft',
  sectionHeader:
    'flex flex-wrap items-center justify-between gap-3 border-b border-border-light px-5 py-4 sm:px-6',
  sectionBody: 'px-5 py-5 sm:px-6 sm:py-6',
  mutedPanel:
    'rounded-3xl border border-border-light bg-surface-secondary shadow-soft',
  input:
    'w-full rounded-2xl border border-border-light bg-surface-primary px-4 py-3 text-sm text-text-primary shadow-xs transition placeholder:text-text-tertiary focus:border-primary-300 focus:outline-none focus:ring-4 focus:ring-primary-100/60 disabled:cursor-not-allowed disabled:bg-neutral-50 disabled:text-text-tertiary',
  inputWithIcon:
    'w-full rounded-2xl border border-border-light bg-surface-primary px-4 py-3 pl-11 text-sm text-text-primary shadow-xs transition placeholder:text-text-tertiary focus:border-primary-300 focus:outline-none focus:ring-4 focus:ring-primary-100/60 disabled:cursor-not-allowed disabled:bg-neutral-50 disabled:text-text-tertiary',
  select:
    'w-full appearance-none rounded-2xl border border-border-light bg-surface-primary px-4 py-3 text-sm text-text-primary shadow-xs transition focus:border-primary-300 focus:outline-none focus:ring-4 focus:ring-primary-100/60 disabled:cursor-not-allowed disabled:bg-neutral-50 disabled:text-text-tertiary',
  textarea:
    'w-full min-h-[120px] rounded-2xl border border-border-light bg-surface-primary px-4 py-3 text-sm text-text-primary shadow-xs transition placeholder:text-text-tertiary focus:border-primary-300 focus:outline-none focus:ring-4 focus:ring-primary-100/60 disabled:cursor-not-allowed disabled:bg-neutral-50 disabled:text-text-tertiary',
  label: 'mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary',
  helperText: 'text-xs leading-5 text-text-tertiary',
  button: {
    primary: cx(buttonBase, 'border-primary-700 bg-primary-700 text-white shadow-soft hover:border-primary-800 hover:bg-primary-800'),
    secondary: cx(buttonBase, 'border-border-medium bg-surface-elevated text-text-primary hover:border-primary-300 hover:bg-primary-50'),
    ghost: cx(buttonBase, 'border-transparent bg-transparent text-text-secondary hover:bg-surface-elevated hover:text-text-primary'),
    accent: cx(buttonBase, 'border-accent-600 bg-accent-500 text-white shadow-soft hover:border-accent-700 hover:bg-accent-600'),
    danger: cx(buttonBase, 'border-error-600 bg-error-500 text-white shadow-soft hover:bg-error-600'),
    success: cx(buttonBase, 'border-success-600 bg-success-500 text-white shadow-soft hover:bg-success-600'),
    soft: cx(buttonBase, 'border-primary-200 bg-primary-50 text-primary-700 hover:bg-primary-100'),
    dark: cx(buttonBase, 'border-primary-900 bg-primary-900 text-white shadow-soft hover:bg-primary-800'),
    icon: cx(buttonBase, 'h-11 w-11 rounded-full p-0'),
    sm: 'px-3 py-2 text-xs',
    lg: 'px-5 py-3.5 text-base',
  },
  badge: {
    base: 'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold capitalize',
    success: 'border-success-200 bg-success-50 text-success-700',
    pending: 'border-warning-200 bg-warning-50 text-warning-700',
    error: 'border-error-200 bg-error-50 text-error-700',
    info: 'border-primary-200 bg-primary-50 text-primary-700',
    neutral: 'border-border-light bg-surface-elevated text-text-secondary',
  },
  tableWrap:
    'overflow-hidden rounded-3xl border border-border-light bg-surface-primary shadow-soft',
  table: 'min-w-full divide-y divide-border-light text-sm',
  tableHead:
    'bg-surface-secondary text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary',
  tableHeadCell: 'px-4 py-3.5',
  tableCell: 'px-4 py-4 align-top text-text-secondary',
  emptyState:
    'rounded-3xl border border-dashed border-border-light bg-surface-primary px-6 py-14 text-center shadow-soft',
  emptyIcon:
    'mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary-50 text-3xl text-primary-700',
  modalOverlay:
    'fixed inset-0 z-[120] flex justify-center bg-slate-950/55 p-4 backdrop-blur-sm overflow-y-auto',
  modalPanel:
    'relative w-full max-w-2xl rounded-[32px] border border-white/60 bg-surface-primary shadow-float my-auto overflow-hidden',
  spinner:
    'h-10 w-10 animate-spin rounded-full border-4 border-border-light border-t-primary-600',
  loadingScreen:
    'flex min-h-[280px] flex-col items-center justify-center gap-4 rounded-3xl border border-border-light bg-surface-primary shadow-soft',
};

export function badgeClass(variant = 'neutral') {
  return cx(ui.badge.base, ui.badge[variant] || ui.badge.neutral);
}

export function bookingStatusClass(status) {
  if (status === 'completed') {
    return badgeClass('success');
  }

  if (status === 'confirmed' || status === 'active') {
    return badgeClass('info');
  }

  if (status === 'pending') {
    return badgeClass('pending');
  }

  if (status === 'cancelled' || status === 'rejected' || status === 'expired') {
    return badgeClass('error');
  }

  return badgeClass('neutral');
}

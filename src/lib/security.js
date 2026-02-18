/**
 * SafeDrive Security Module
 * =========================
 * Comprehensive client-side security utilities implementing:
 * - OWASP Top 10 (2021) mitigations
 * - ISO 27001/27002 compliance controls
 * - Security 10-Code incident classification
 * 
 * ISO 27001 Ref: A.14.2.5 - Secure system engineering principles
 */

import { supabase } from './supabase';

// =============================================
// A03:2021 — INPUT SANITIZATION & VALIDATION
// ISO 27001: A.14.2.5 Secure system engineering
// =============================================

// XSS-dangerous patterns
const XSS_PATTERNS = [
    /<script\b[^>]*>([\s\S]*?)<\/script>/gi,
    /on\w+\s*=\s*["'][^"']*["']/gi,
    /javascript\s*:/gi,
    /data\s*:\s*text\/html/gi,
    /<iframe\b[^>]*>/gi,
    /<object\b[^>]*>/gi,
    /<embed\b[^>]*>/gi,
    /<form\b[^>]*>/gi,
    /expression\s*\(/gi,
    /url\s*\(\s*['"]?\s*javascript/gi,
];

// SQL injection patterns
const SQL_PATTERNS = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION|TRUNCATE)\b.*\b(FROM|INTO|TABLE|SET|WHERE|ALL)\b)/gi,
    /(--|;|\/\*|\*\/)/g,
    /(\bOR\b\s+\d+\s*=\s*\d+)/gi,
    /('\s*(OR|AND)\s+')/gi,
    /(CHAR\s*\(|CONCAT\s*\(|0x[0-9a-fA-F]+)/gi,
];

/**
 * Sanitize text input — strips HTML tags and XSS vectors
 * @param {string} input - Raw input string
 * @returns {string} Sanitized string
 */
export function sanitizeInput(input) {
    if (typeof input !== 'string') return '';

    let clean = input
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;');

    return clean.trim();
}

/**
 * Deep-sanitize an entire object
 */
export function sanitizeObject(obj) {
    if (typeof obj === 'string') return sanitizeInput(obj);
    if (Array.isArray(obj)) return obj.map(sanitizeObject);
    if (obj && typeof obj === 'object') {
        const sanitized = {};
        for (const [key, value] of Object.entries(obj)) {
            sanitized[sanitizeInput(key)] = sanitizeObject(value);
        }
        return sanitized;
    }
    return obj;
}

/**
 * Detect XSS or injection attempts in input
 * Returns { safe: boolean, threats: string[] }
 */
export function detectThreats(input) {
    if (typeof input !== 'string') return { safe: true, threats: [] };

    const threats = [];

    for (const pattern of XSS_PATTERNS) {
        pattern.lastIndex = 0;
        if (pattern.test(input)) {
            threats.push('xss');
            break;
        }
    }

    for (const pattern of SQL_PATTERNS) {
        pattern.lastIndex = 0;
        if (pattern.test(input)) {
            threats.push('sql_injection');
            break;
        }
    }

    // Path traversal
    if (/\.\.[\/\\]/.test(input)) {
        threats.push('path_traversal');
    }

    // Command injection
    if (/[;&|`$()]/.test(input) && input.length > 3) {
        // Only flag if it looks like an actual command
        if (/(\bcat\b|\brm\b|\bwget\b|\bcurl\b|\bchmod\b|\bsudo\b)/i.test(input)) {
            threats.push('command_injection');
        }
    }

    return { safe: threats.length === 0, threats };
}

/**
 * Validate input against registered rules
 */
export function validateField(fieldName, value, rules) {
    const errors = [];
    const fieldRules = rules?.filter(r => r.field_name === fieldName && r.is_active) || [];

    for (const rule of fieldRules) {
        switch (rule.validation_type) {
            case 'regex': {
                const regex = new RegExp(rule.validation_rule);
                if (value && !regex.test(value)) {
                    errors.push({ message: rule.error_message, severity: rule.severity });
                }
                break;
            }
            case 'length': {
                const [min, max] = rule.validation_rule.split(':').map(Number);
                if (value && (value.length < min || value.length > max)) {
                    errors.push({ message: rule.error_message, severity: rule.severity });
                }
                break;
            }
            case 'range': {
                const [min, max] = rule.validation_rule.split(':').map(Number);
                const num = Number(value);
                if (value && (num < min || num > max)) {
                    errors.push({ message: rule.error_message, severity: rule.severity });
                }
                break;
            }
        }
    }

    return errors;
}


// =============================================
// A07:2021 — AUTHENTICATION SECURITY
// ISO 27001: A.9.4.2 Secure log-on procedures
// =============================================

/**
 * Password strength checker (NIST SP 800-63B aligned)
 * Returns { score: 0-5, feedback: string[], passing: boolean }
 */
export function checkPasswordStrength(password) {
    const feedback = [];
    let score = 0;

    if (!password) return { score: 0, feedback: ['Password is required'], passing: false };

    // Length checks
    if (password.length >= 8) score++;
    else feedback.push('At least 8 characters required');

    if (password.length >= 12) score++;

    // Character class checks
    if (/[A-Z]/.test(password)) score++;
    else feedback.push('Add at least one uppercase letter');

    if (/[a-z]/.test(password)) {
        // no extra score, but it's expected
    } else {
        feedback.push('Add at least one lowercase letter');
    }

    if (/[0-9]/.test(password)) score++;
    else feedback.push('Add at least one number');

    if (/[^A-Za-z0-9]/.test(password)) score++;
    else feedback.push('Add a special character (!@#$%^&*)');

    // Common password check
    const commonPasswords = [
        'password', '123456', 'qwerty', 'abc123', 'letmein', 'admin',
        'welcome', 'monkey', 'dragon', 'master', 'login', 'princess',
        'password1', 'iloveyou', '12345678', 'safedrive',
    ];

    if (commonPasswords.includes(password.toLowerCase())) {
        score = 0;
        feedback.push('This is a commonly used password — choose something unique');
    }

    // Repeated characters check
    if (/(.)\1{3,}/.test(password)) {
        score = Math.max(0, score - 1);
        feedback.push('Avoid repeating characters');
    }

    // Sequential characters check
    if (/(?:abc|bcd|cde|def|efg|fgh|ghi|hij|ijk|jkl|klm|lmn|mno|nop|opq|pqr|qrs|rst|stu|tuv|uvw|vwx|wxy|xyz|012|123|234|345|456|567|678|789)/i.test(password)) {
        score = Math.max(0, score - 1);
        feedback.push('Avoid sequential characters');
    }

    return {
        score,
        feedback,
        passing: score >= 3 && password.length >= 8,
        level: score <= 1 ? 'weak' : score <= 2 ? 'fair' : score <= 3 ? 'good' : score <= 4 ? 'strong' : 'excellent',
    };
}


// =============================================
// A09:2021 — SECURITY AUDIT LOGGING
// ISO 27001: A.12.4 Logging and monitoring
// =============================================

/**
 * Log a security audit event to the database
 */
export async function logSecurityEvent(eventType, description, options = {}) {
    try {
        const { data: { user } } = await supabase.auth.getUser();

        const logEntry = {
            user_id: user?.id || null,
            user_email: user?.email || null,
            event_type: eventType,
            event_description: description,
            resource_type: options.resourceType || null,
            resource_id: options.resourceId || null,
            severity: options.severity || 'info',
            owasp_category: options.owaspCategory || null,
            metadata: options.metadata || null,
            ip_address: null, // Filled server-side
            user_agent: navigator.userAgent,
        };

        await supabase.from('security_audit_logs').insert(logEntry);
    } catch (err) {
        // Silent fail — logging should never break the app
        console.warn('[SecurityAudit] Failed to log event:', err.message);
    }
}

/**
 * Log a failed login attempt
 */
export async function logFailedLogin(email, reason = 'invalid_password') {
    try {
        await supabase.from('failed_login_attempts').insert({
            email,
            failure_reason: reason,
            user_agent: navigator.userAgent,
        });

        await logSecurityEvent('auth.login_failed', `Failed login for ${email}: ${reason}`, {
            severity: 'warning',
            owaspCategory: 'A07-Auth-Failures',
            metadata: { email, reason },
        });
    } catch (err) {
        console.warn('[SecurityAudit] Failed to log login attempt:', err.message);
    }
}

/**
 * Log an injection or XSS attempt
 */
export async function logInjectionAttempt(attemptType, payload, fieldName) {
    try {
        await supabase.from('injection_attempt_logs').insert({
            attempt_type: attemptType,
            payload: sanitizeInput(payload.substring(0, 500)), // Truncate & sanitize the payload itself
            field_name: fieldName,
            was_blocked: true,
            threat_level: attemptType === 'sql_injection' ? 'high' : 'medium',
            user_agent: navigator.userAgent,
        });

        await logSecurityEvent('security.injection_attempt', `${attemptType} attempt blocked on field: ${fieldName}`, {
            severity: 'critical',
            owaspCategory: 'A03-Injection',
            metadata: { attemptType, fieldName },
        });
    } catch (err) {
        console.warn('[SecurityAudit] Failed to log injection attempt:', err.message);
    }
}


// =============================================
// SECURITY 10-CODE INCIDENT REPORTING
// ISO 27001: A.16 Incident Management
// =============================================

export const TEN_CODES = {
    '10-4': { label: 'Acknowledged', description: 'Under Review', severity: 'P5-Info' },
    '10-7': { label: 'Out of Service', description: 'System Down', severity: 'P2-High' },
    '10-8': { label: 'In Service', description: 'System Restored', severity: 'P5-Info' },
    '10-10': { label: 'Active Attack', description: 'Breach in Progress', severity: 'P1-Critical' },
    '10-20': { label: 'Located', description: 'Source Traced', severity: 'P3-Medium' },
    '10-32': { label: 'High Threat', description: 'High Severity Threat', severity: 'P1-Critical' },
    '10-33': { label: 'Emergency', description: 'Critical Incident', severity: 'P1-Critical' },
    '10-89': { label: 'Data Breach', description: 'Data Breach Threat', severity: 'P1-Critical' },
    '10-90': { label: 'System Alert', description: 'System-Wide Alert', severity: 'P1-Critical' },
};

/**
 * Report a security incident with 10-Code classification
 */
export async function reportSecurityIncident(tenCode, category, title, description) {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        const codeInfo = TEN_CODES[tenCode] || TEN_CODES['10-4'];

        const { data, error } = await supabase.rpc('create_security_incident', {
            p_ten_code: tenCode,
            p_category: category,
            p_severity: codeInfo.severity,
            p_title: title,
            p_description: description,
            p_reported_by: user?.id || null,
            p_affected_systems: ['safedrive-web'],
        });

        if (error) throw error;
        return data;
    } catch (err) {
        console.error('[SecurityIncident] Failed to create:', err.message);
        // Fallback: at least log it
        await logSecurityEvent('security.suspicious_activity', `Incident: ${title}`, {
            severity: 'critical',
            metadata: { tenCode, category, title, description },
        });
    }
}


// =============================================
// A01:2021 — ACCESS CONTROL ENFORCEMENT
// ISO 27001: A.9.1.1 Access control policy
// =============================================

/**
 * Client-side route guard — checks if a user has permission
 * for a specific resource+action combination
 */
export async function checkPermission(userRole, resource, action) {
    try {
        const { data, error } = await supabase
            .from('permissions')
            .select('*')
            .eq('role', userRole)
            .eq('resource', resource)
            .eq('action', action)
            .eq('is_allowed', true)
            .maybeSingle();

        if (error) throw error;

        const allowed = !!data;

        // Log the access control check
        const { data: { user } } = await supabase.auth.getUser();

        await supabase.from('access_control_logs').insert({
            user_id: user?.id,
            resource,
            action,
            was_allowed: allowed,
            denial_reason: allowed ? null : `Role '${userRole}' lacks permission`,
            user_agent: navigator.userAgent,
        });

        return { allowed, conditions: data?.conditions || null };
    } catch (err) {
        console.warn('[AccessControl] Check failed:', err.message);
        return { allowed: false, conditions: null };
    }
}


// =============================================
// A04:2021 — RATE LIMITING (CLIENT-SIDE)
// ISO 27001: A.14.1 Security requirements
// =============================================

const rateLimitBuckets = new Map();

/**
 * Client-side rate limiter using token bucket algorithm
 * @param {string} action - Action identifier (e.g., 'login', 'booking')
 * @param {number} maxRequests - Max requests allowed
 * @param {number} windowMs - Time window in milliseconds
 * @returns {boolean} Whether the action is allowed
 */
export function clientRateLimit(action, maxRequests = 10, windowMs = 60000) {
    const now = Date.now();
    const key = action;

    if (!rateLimitBuckets.has(key)) {
        rateLimitBuckets.set(key, { count: 0, resetAt: now + windowMs });
    }

    const bucket = rateLimitBuckets.get(key);

    // Reset window if expired
    if (now > bucket.resetAt) {
        bucket.count = 0;
        bucket.resetAt = now + windowMs;
    }

    bucket.count++;

    if (bucket.count > maxRequests) {
        logSecurityEvent('security.rate_limit_exceeded', `Client rate limit hit: ${action}`, {
            severity: 'warning',
            metadata: { action, count: bucket.count, limit: maxRequests },
        });
        return false;
    }

    return true;
}


// =============================================
// A05:2021 — SECURITY HEADERS (CSP)
// ISO 27001: A.13.1 Network security
// =============================================

/**
 * Get Content Security Policy meta tag content
 * Should be added to index.html <head>
 */
export function getCSPPolicy() {
    return [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'",  // Required for Vite HMR in dev
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data: blob: https://*.supabase.co https://images.unsplash.com",
        "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
        "frame-src 'none'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
    ].join('; ');
}


// =============================================
// A02:2021 — DATA MASKING
// ISO 27001: A.10.1 Cryptographic controls
// =============================================

/**
 * Mask sensitive data for display purposes
 */
export function maskData(value, type = 'partial') {
    if (!value) return '***';

    switch (type) {
        case 'email': {
            const [user, domain] = value.split('@');
            if (!domain) return '***';
            return user.substring(0, 2) + '***@' + domain;
        }
        case 'phone': {
            return value.substring(0, 4) + '****' + value.substring(value.length - 2);
        }
        case 'id_number': {
            return value.substring(0, 3) + '-****-' + value.substring(value.length - 3);
        }
        case 'partial': {
            if (value.length <= 4) return '****';
            return value.substring(0, 2) + '*'.repeat(value.length - 4) + value.substring(value.length - 2);
        }
        case 'full':
            return '********';
        default:
            return value;
    }
}


// =============================================
// SESSION SECURITY
// ISO 27001: A.9.4 System access control
// =============================================

/**
 * Monitor session activity — auto-logout on idle
 */
export function initSessionMonitor(idleTimeoutMs = 30 * 60 * 1000) {
    let lastActivity = Date.now();
    let warningShown = false;

    const resetTimer = () => {
        lastActivity = Date.now();
        warningShown = false;
    };

    // Track user activity
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    events.forEach(event => window.addEventListener(event, resetTimer, { passive: true }));

    // Check idle periodically
    const interval = setInterval(async () => {
        const idle = Date.now() - lastActivity;

        // Warning at 80% of timeout
        if (idle > idleTimeoutMs * 0.8 && !warningShown) {
            warningShown = true;
            // Dispatch custom event for UI to show warning
            window.dispatchEvent(new CustomEvent('session:idle-warning', {
                detail: { remainingMs: idleTimeoutMs - idle }
            }));
        }

        // Auto-logout at timeout
        if (idle > idleTimeoutMs) {
            await logSecurityEvent('auth.session_revoked', 'Session timed out due to inactivity', {
                severity: 'info',
            });
            await supabase.auth.signOut();
            window.location.href = '/login?reason=timeout';
        }
    }, 60000); // Check every minute

    // Cleanup function
    return () => {
        clearInterval(interval);
        events.forEach(event => window.removeEventListener(event, resetTimer));
    };
}


// =============================================
// FILE UPLOAD SECURITY
// ISO 27001: A.14.1 Security requirements
// =============================================

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * Validate uploaded file for security
 * Returns { valid: boolean, error?: string }
 */
export function validateFileUpload(file, options = {}) {
    const allowedTypes = options.allowedTypes || ALLOWED_IMAGE_TYPES;
    const maxSize = options.maxSize || MAX_FILE_SIZE;

    if (!file) return { valid: false, error: 'No file selected' };

    // Type check
    if (!allowedTypes.includes(file.type)) {
        logSecurityEvent('security.suspicious_activity', `Blocked file upload: invalid type ${file.type}`, {
            severity: 'warning',
            metadata: { fileName: file.name, type: file.type, size: file.size },
        });
        return { valid: false, error: `File type not allowed. Accepted: ${allowedTypes.join(', ')}` };
    }

    // Size check
    if (file.size > maxSize) {
        return { valid: false, error: `File too large. Maximum: ${(maxSize / 1024 / 1024).toFixed(0)}MB` };
    }

    // Name sanitization check (path traversal prevention)
    if (/[<>:"/\\|?*]/.test(file.name) || /\.\./.test(file.name)) {
        logSecurityEvent('security.suspicious_activity', `Blocked file upload: suspicious filename ${file.name}`, {
            severity: 'warning',
            owaspCategory: 'A03-Injection',
        });
        return { valid: false, error: 'Invalid file name' };
    }

    // Double extension check
    const extensions = file.name.split('.').slice(1);
    if (extensions.length > 1) {
        const suspiciousExts = ['exe', 'bat', 'cmd', 'sh', 'php', 'js', 'html', 'svg'];
        if (extensions.some(ext => suspiciousExts.includes(ext.toLowerCase()))) {
            logSecurityEvent('security.suspicious_activity', `Blocked file: double extension ${file.name}`, {
                severity: 'critical',
                owaspCategory: 'A03-Injection',
            });
            return { valid: false, error: 'Suspicious file detected' };
        }
    }

    return { valid: true };
}

/**
 * Generate a safe filename for upload
 */
export function generateSafeFilename(originalName, userId) {
    const ext = originalName.split('.').pop()?.toLowerCase() || 'jpg';
    const safeExt = ['jpg', 'jpeg', 'png', 'webp'].includes(ext) ? ext : 'jpg';
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `${userId}/${timestamp}-${random}.${safeExt}`;
}

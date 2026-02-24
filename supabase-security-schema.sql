-- =============================================
-- SAFEDRIVE: Security Hardening Schema
-- OWASP Top 10 (2021) + ISO 27001/27002 + 10-Codes
-- =============================================

-- =============================================
-- A01:2021 - BROKEN ACCESS CONTROL
-- ISO 27001: A.9 Access Control
-- =============================================

-- Role-based permission matrix
CREATE TABLE public.permissions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('admin', 'renter', 'rentee', 'super_admin')),
  resource TEXT NOT NULL,           -- e.g., 'vehicles', 'bookings', 'profiles', 'admin_panel'
  action TEXT NOT NULL CHECK (action IN ('create', 'read', 'update', 'delete', 'manage', 'export')),
  is_allowed BOOLEAN DEFAULT FALSE,
  conditions JSONB,                 -- Additional conditions (e.g., {"own_only": true})
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Access control audit log (tracks all permission checks)
CREATE TABLE public.access_control_logs (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  resource TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_id UUID,
  was_allowed BOOLEAN NOT NULL,
  denial_reason TEXT,
  ip_address INET,
  user_agent TEXT,
  request_path TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default permission matrix
INSERT INTO public.permissions (role, resource, action, is_allowed, conditions) VALUES
  -- Super Admin (unrestricted)
  ('super_admin', 'profiles', 'manage', true, null),
  ('super_admin', 'vehicles', 'manage', true, null),
  ('super_admin', 'bookings', 'manage', true, null),
  ('super_admin', 'admin_panel', 'manage', true, null),
  ('super_admin', 'security_logs', 'manage', true, null),
  ('super_admin', 'security_incidents', 'manage', true, null),
  
  -- Admin
  ('admin', 'profiles', 'read', true, null),
  ('admin', 'profiles', 'update', true, null),
  ('admin', 'vehicles', 'read', true, null),
  ('admin', 'vehicles', 'update', true, null),
  ('admin', 'bookings', 'read', true, null),
  ('admin', 'bookings', 'update', true, null),
  ('admin', 'admin_panel', 'read', true, null),
  ('admin', 'security_logs', 'read', true, null),
  ('admin', 'security_incidents', 'create', true, null),
  
  -- Renter (vehicle owner who lists cars)
  ('renter', 'profiles', 'read', true, '{"own_only": true}'),
  ('renter', 'profiles', 'update', true, '{"own_only": true}'),
  ('renter', 'vehicles', 'create', true, null),
  ('renter', 'vehicles', 'read', true, null),
  ('renter', 'vehicles', 'update', true, '{"own_only": true}'),
  ('renter', 'vehicles', 'delete', true, '{"own_only": true}'),
  ('renter', 'bookings', 'read', true, '{"own_only": true}'),
  ('renter', 'bookings', 'update', true, '{"own_only": true}'),
  
  -- Rentee (person who rents cars)
  ('rentee', 'profiles', 'read', true, '{"own_only": true}'),
  ('rentee', 'profiles', 'update', true, '{"own_only": true}'),
  ('rentee', 'vehicles', 'read', true, null),
  ('rentee', 'bookings', 'create', true, null),
  ('rentee', 'bookings', 'read', true, '{"own_only": true}');

-- =============================================
-- A02:2021 - CRYPTOGRAPHIC FAILURES
-- ISO 27001: A.10 Cryptography
-- =============================================

-- Data classification register (ISO 27001 A.8.2)
CREATE TABLE public.data_classification (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  table_name TEXT NOT NULL,
  column_name TEXT NOT NULL,
  classification TEXT NOT NULL CHECK (classification IN (
    'public',           -- Freely accessible
    'internal',         -- Accessible to authenticated users
    'confidential',     -- Restricted to authorized roles
    'restricted'        -- Highly sensitive (PII, financial)
  )),
  pii_flag BOOLEAN DEFAULT FALSE,        -- Personal Identifiable Information
  encryption_required BOOLEAN DEFAULT FALSE,
  masking_rule TEXT,                      -- e.g., 'partial', 'full', 'hash'
  retention_days INTEGER DEFAULT 365,     -- Data retention period
  legal_basis TEXT,                       -- GDPR/DPA legal basis
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Register sensitive data columns
INSERT INTO public.data_classification (table_name, column_name, classification, pii_flag, encryption_required, masking_rule, retention_days, legal_basis) VALUES
  ('profiles', 'email', 'confidential', true, false, 'partial', 730, 'Contract performance'),
  ('profiles', 'phone', 'confidential', true, false, 'partial', 730, 'Contract performance'),
  ('profiles', 'date_of_birth', 'restricted', true, false, 'full', 730, 'Identity verification'),
  ('profiles', 'national_id_number', 'restricted', true, true, 'partial', 365, 'Legal obligation'),
  ('profiles', 'drivers_license_number', 'restricted', true, true, 'partial', 365, 'Legal obligation'),
  ('profiles', 'selfie_url', 'restricted', true, false, 'full', 365, 'Identity verification'),
  ('profiles', 'national_id_front_url', 'restricted', true, false, 'full', 365, 'Identity verification'),
  ('profiles', 'national_id_back_url', 'restricted', true, false, 'full', 365, 'Identity verification'),
  ('profiles', 'address', 'confidential', true, false, 'partial', 730, 'Contract performance'),
  ('vehicles', 'plate_number', 'confidential', false, false, 'partial', 730, 'Contract performance'),
  ('bookings', 'total_amount', 'confidential', false, false, null, 1825, 'Legal obligation'),
  ('bookings', 'renter_selfie_at_pickup', 'restricted', true, false, 'full', 365, 'Identity verification'),
  ('rental_agreements', 'terms_and_conditions', 'internal', false, false, null, 1825, 'Legal obligation'),
  ('rental_agreements', 'owner_signature_ip', 'confidential', true, false, 'full', 1825, 'Legal obligation'),
  ('rental_agreements', 'renter_signature_ip', 'confidential', true, false, 'full', 1825, 'Legal obligation');

-- Encryption keys registry (metadata only, actual keys stored in Vault)
CREATE TABLE public.encryption_key_registry (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  key_alias TEXT UNIQUE NOT NULL,
  algorithm TEXT NOT NULL DEFAULT 'AES-256-GCM',
  purpose TEXT NOT NULL,
  rotation_interval_days INTEGER DEFAULT 90,
  last_rotated_at TIMESTAMPTZ DEFAULT NOW(),
  next_rotation_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '90 days'),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'rotating', 'retired', 'compromised')),
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- A03:2021 - INJECTION PREVENTION
-- ISO 27001: A.14.2 Security in development
-- =============================================

-- Input validation rules registry
CREATE TABLE public.input_validation_rules (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  field_name TEXT NOT NULL,
  table_name TEXT NOT NULL,
  validation_type TEXT NOT NULL CHECK (validation_type IN ('regex', 'length', 'enum', 'range', 'custom')),
  validation_rule TEXT NOT NULL,     -- Regex pattern or validation spec
  error_message TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  severity TEXT DEFAULT 'block' CHECK (severity IN ('block', 'warn', 'log')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Define input validation rules
INSERT INTO public.input_validation_rules (field_name, table_name, validation_type, validation_rule, error_message, severity) VALUES
  ('email', 'profiles', 'regex', '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$', 'Invalid email format', 'block'),
  ('phone', 'profiles', 'regex', '^(09|\+639)\d{9}$', 'Invalid Philippine phone number', 'block'),
  ('full_name', 'profiles', 'regex', '^[a-zA-ZÀ-ÿ\s\-\.]{2,100}$', 'Invalid name: only letters, spaces, hyphens allowed', 'block'),
  ('full_name', 'profiles', 'length', '2:100', 'Name must be 2-100 characters', 'block'),
  ('plate_number', 'vehicles', 'regex', '^[A-Z0-9\s\-]{3,10}$', 'Invalid plate number format', 'block'),
  ('daily_rate', 'vehicles', 'range', '100:1000000', 'Daily rate must be between ₱100 and ₱1,000,000', 'block'),
  ('seating_capacity', 'vehicles', 'range', '2:15', 'Seating capacity must be 2-15', 'block'),
  ('rating', 'reviews', 'range', '1:5', 'Rating must be 1-5', 'block'),
  ('comment', 'reviews', 'length', '0:2000', 'Review must be under 2000 characters', 'block'),
  ('description', 'vehicles', 'length', '0:5000', 'Description must be under 5000 characters', 'warn'),
  ('national_id_number', 'profiles', 'regex', '^[0-9\-]{8,20}$', 'Invalid ID number format', 'block'),
  ('drivers_license_number', 'profiles', 'regex', '^[A-Z0-9\-]{5,20}$', 'Invalid license number format', 'block');

-- SQL injection attempt log
CREATE TABLE public.injection_attempt_logs (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  attempt_type TEXT NOT NULL CHECK (attempt_type IN ('sql_injection', 'xss', 'command_injection', 'path_traversal', 'ldap_injection')),
  payload TEXT NOT NULL,               -- The suspicious input (sanitized)
  field_name TEXT,
  ip_address INET,
  user_agent TEXT,
  was_blocked BOOLEAN DEFAULT TRUE,
  threat_level TEXT DEFAULT 'medium' CHECK (threat_level IN ('low', 'medium', 'high', 'critical')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- A07:2021 - IDENTIFICATION & AUTHENTICATION
-- ISO 27001: A.9.4 System and application access control
-- =============================================

-- Failed login attempts (brute force protection)
CREATE TABLE public.failed_login_attempts (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  email TEXT NOT NULL,
  ip_address INET,
  user_agent TEXT,
  failure_reason TEXT CHECK (failure_reason IN ('invalid_password', 'account_locked', 'account_disabled', 'invalid_email', 'mfa_failed', 'captcha_failed')),
  attempt_count INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Account lockout policy
CREATE TABLE public.account_lockouts (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  locked_at TIMESTAMPTZ DEFAULT NOW(),
  unlock_at TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('brute_force', 'suspicious_activity', 'admin_action', 'policy_violation')),
  locked_by TEXT DEFAULT 'system',      -- 'system' or admin user ID
  is_active BOOLEAN DEFAULT TRUE,
  unlocked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User session management
CREATE TABLE public.user_sessions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  session_token_hash TEXT NOT NULL,      -- Hashed session token
  ip_address INET,
  user_agent TEXT,
  device_fingerprint TEXT,
  geo_location TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  last_activity_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoke_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Password policy config
CREATE TABLE public.password_policies (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  policy_name TEXT UNIQUE NOT NULL,
  min_length INTEGER DEFAULT 8,
  require_uppercase BOOLEAN DEFAULT TRUE,
  require_lowercase BOOLEAN DEFAULT TRUE,
  require_numbers BOOLEAN DEFAULT TRUE,
  require_special_chars BOOLEAN DEFAULT TRUE,
  max_age_days INTEGER DEFAULT 90,        -- Password expiry
  min_age_days INTEGER DEFAULT 1,         -- Minimum time before change
  history_count INTEGER DEFAULT 5,        -- Cannot reuse last N passwords
  max_failed_attempts INTEGER DEFAULT 5,  -- Before lockout
  lockout_duration_minutes INTEGER DEFAULT 30,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO public.password_policies (policy_name, min_length, max_failed_attempts, lockout_duration_minutes) VALUES
  ('default', 8, 5, 30),
  ('admin', 12, 3, 60);

-- =============================================
-- A09:2021 - SECURITY LOGGING & MONITORING
-- ISO 27001: A.12.4 Logging and monitoring
-- =============================================

-- Comprehensive security audit log
CREATE TABLE public.security_audit_logs (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  
  -- WHO
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  user_email TEXT,
  user_role TEXT,
  
  -- WHAT
  event_type TEXT NOT NULL CHECK (event_type IN (
    -- Authentication events
    'auth.login', 'auth.logout', 'auth.login_failed', 'auth.password_change',
    'auth.password_reset', 'auth.mfa_enabled', 'auth.mfa_disabled',
    'auth.session_created', 'auth.session_revoked', 'auth.account_locked',
    'auth.account_unlocked',
    -- Authorization events
    'access.granted', 'access.denied', 'access.escalation_attempt',
    'access.role_change', 'access.permission_change',
    -- Data events
    'data.create', 'data.read', 'data.update', 'data.delete',
    'data.export', 'data.bulk_operation',
    -- Security events
    'security.injection_attempt', 'security.xss_attempt', 'security.brute_force',
    'security.suspicious_activity', 'security.rate_limit_exceeded',
    'security.invalid_token', 'security.csrf_violation',
    -- Verification events
    'verify.id_submitted', 'verify.id_approved', 'verify.id_rejected',
    'verify.selfie_submitted', 'verify.selfie_matched', 'verify.selfie_failed',
    -- Business events
    'booking.created', 'booking.confirmed', 'booking.cancelled',
    'booking.completed', 'booking.disputed',
    'vehicle.listed', 'vehicle.approved', 'vehicle.rejected',
    'agreement.created', 'agreement.signed', 'agreement.violated',
    'payment.initiated', 'payment.completed', 'payment.failed',
    -- Admin events
    'admin.user_verify', 'admin.user_reject', 'admin.vehicle_approve',
    'admin.vehicle_reject', 'admin.config_change', 'admin.data_export'
  )),
  event_description TEXT,
  
  -- WHERE
  resource_type TEXT,       -- 'profile', 'vehicle', 'booking', etc.
  resource_id UUID,
  
  -- CONTEXT
  ip_address INET,
  user_agent TEXT,
  geo_location TEXT,
  request_method TEXT,
  request_path TEXT,
  
  -- DETAILS
  metadata JSONB,           -- Additional event-specific data
  old_values JSONB,         -- Before state (for updates)
  new_values JSONB,         -- After state (for updates)
  
  -- SEVERITY (aligns with ISO 27001)
  severity TEXT DEFAULT 'info' CHECK (severity IN ('debug', 'info', 'warning', 'error', 'critical')),
  
  -- OWASP category
  owasp_category TEXT CHECK (owasp_category IN (
    'A01-Broken-Access-Control', 'A02-Cryptographic-Failures',
    'A03-Injection', 'A04-Insecure-Design', 'A05-Security-Misconfiguration',
    'A06-Vulnerable-Components', 'A07-Auth-Failures',
    'A08-Integrity-Failures', 'A09-Logging-Failures', 'A10-SSRF'
  )),
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for efficient querying
CREATE INDEX idx_audit_logs_user ON public.security_audit_logs(user_id);
CREATE INDEX idx_audit_logs_event ON public.security_audit_logs(event_type);
CREATE INDEX idx_audit_logs_severity ON public.security_audit_logs(severity);
CREATE INDEX idx_audit_logs_created ON public.security_audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_owasp ON public.security_audit_logs(owasp_category);

-- =============================================
-- SECURITY INCIDENTS (10-Codes Integration)
-- ISO 27001: A.16 Information security incident management
-- =============================================

CREATE TABLE public.security_incidents (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  
  -- Incident identification
  incident_number TEXT UNIQUE NOT NULL,   -- Auto-generated: INC-2026-XXXX
  
  -- 10-Code classification
  ten_code TEXT NOT NULL CHECK (ten_code IN (
    '10-4',    -- Acknowledged / Under Review
    '10-7',    -- Service Unavailable / System Down
    '10-8',    -- Service Restored / System Up 
    '10-10',   -- Active Attack / Breach in Progress
    '10-20',   -- Location Identified / Source Traced
    '10-32',   -- High Severity Threat
    '10-33',   -- Emergency / Critical Incident
    '10-89',   -- Data Breach Threat
    '10-90'    -- System-wide Alert
  )),
  ten_code_description TEXT,
  
  -- Classification (ISO 27035)
  category TEXT NOT NULL CHECK (category IN (
    'unauthorized_access',    -- A01
    'data_breach',           -- A02
    'injection_attack',      -- A03
    'design_flaw',           -- A04
    'misconfiguration',      -- A05
    'vulnerable_component',  -- A06
    'auth_failure',          -- A07
    'integrity_violation',   -- A08
    'monitoring_gap',        -- A09
    'ssrf_attack',           -- A10
    'social_engineering',
    'malware',
    'dos_attack',
    'physical_security',
    'policy_violation',
    'other'
  )),
  
  -- Severity (ISO 27001 aligned)
  severity TEXT NOT NULL CHECK (severity IN ('P1-Critical', 'P2-High', 'P3-Medium', 'P4-Low', 'P5-Info')),
  
  -- Details
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  affected_systems TEXT[],
  affected_users UUID[],
  attack_vector TEXT,
  
  -- Impact assessment (ISO 27001 A.16.1.4)
  confidentiality_impact TEXT CHECK (confidentiality_impact IN ('none', 'low', 'medium', 'high', 'critical')),
  integrity_impact TEXT CHECK (integrity_impact IN ('none', 'low', 'medium', 'high', 'critical')),
  availability_impact TEXT CHECK (availability_impact IN ('none', 'low', 'medium', 'high', 'critical')),
  
  -- Response
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
    'open', 'investigating', 'containing', 'eradicating', 
    'recovering', 'resolved', 'closed', 'false_positive'
  )),
  assigned_to UUID REFERENCES public.profiles(id),
  response_actions TEXT[],
  lessons_learned TEXT,
  
  -- Timestamps
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  responded_at TIMESTAMPTZ,
  contained_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  
  -- Reporting
  reported_by UUID REFERENCES public.profiles(id),
  report_source TEXT CHECK (report_source IN ('automated', 'user_report', 'admin_detection', 'external', 'audit')),
  
  -- ISO 27001 compliance
  requires_notification BOOLEAN DEFAULT FALSE,   -- Data breach notification
  notification_sent_at TIMESTAMPTZ,
  root_cause TEXT,
  preventive_measures TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-generate incident numbers
CREATE OR REPLACE FUNCTION public.generate_incident_number()
RETURNS TRIGGER AS $$
DECLARE
  seq_num INTEGER;
BEGIN
  SELECT COUNT(*) + 1 INTO seq_num FROM public.security_incidents 
  WHERE EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM NOW());
  NEW.incident_number := 'INC-' || EXTRACT(YEAR FROM NOW()) || '-' || LPAD(seq_num::TEXT, 4, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_incident_number
  BEFORE INSERT ON public.security_incidents
  FOR EACH ROW EXECUTE FUNCTION public.generate_incident_number();

-- =============================================
-- A04:2021 - INSECURE DESIGN PREVENTION
-- ISO 27001: A.14.1 Security requirements
-- =============================================

-- Rate limiting configuration
CREATE TABLE public.rate_limits (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  endpoint TEXT NOT NULL,              -- API endpoint or action
  method TEXT DEFAULT 'ALL',
  max_requests INTEGER NOT NULL,       -- Max requests per window
  window_seconds INTEGER NOT NULL,     -- Time window in seconds
  applies_to TEXT DEFAULT 'all' CHECK (applies_to IN ('all', 'authenticated', 'unauthenticated', 'admin')),
  penalty_action TEXT DEFAULT 'block' CHECK (penalty_action IN ('block', 'throttle', 'captcha', 'alert')),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO public.rate_limits (endpoint, max_requests, window_seconds, applies_to, penalty_action) VALUES
  ('auth/login', 5, 300, 'unauthenticated', 'block'),          -- 5 login attempts per 5 min
  ('auth/register', 3, 3600, 'unauthenticated', 'block'),      -- 3 registrations per hour per IP
  ('auth/password-reset', 3, 3600, 'all', 'block'),             -- 3 resets per hour
  ('bookings/create', 10, 3600, 'authenticated', 'throttle'),   -- 10 bookings per hour
  ('vehicles/create', 5, 3600, 'authenticated', 'throttle'),    -- 5 vehicle listings per hour
  ('reviews/create', 5, 3600, 'authenticated', 'throttle'),     -- 5 reviews per hour
  ('favorites/toggle', 30, 60, 'authenticated', 'throttle'),    -- 30 favorites per minute
  ('api/general', 100, 60, 'authenticated', 'throttle'),        -- 100 API calls per minute
  ('api/general', 30, 60, 'unauthenticated', 'block'),          -- 30 API calls per minute (unauth)
  ('data/export', 2, 3600, 'admin', 'block');                   -- 2 exports per hour

-- Rate limit tracking
CREATE TABLE public.rate_limit_tracking (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  identifier TEXT NOT NULL,           -- user_id or IP address
  endpoint TEXT NOT NULL,
  request_count INTEGER DEFAULT 1,
  window_start TIMESTAMPTZ DEFAULT NOW(),
  window_end TIMESTAMPTZ NOT NULL,
  is_blocked BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_rate_limit_identifier ON public.rate_limit_tracking(identifier, endpoint);

-- =============================================
-- A05:2021 - SECURITY CONFIGURATION
-- ISO 27001: A.12.1 Operational procedures
-- =============================================

-- Security configuration registry
CREATE TABLE public.security_config (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  config_key TEXT UNIQUE NOT NULL,
  config_value TEXT NOT NULL,
  config_type TEXT CHECK (config_type IN ('string', 'number', 'boolean', 'json')),
  description TEXT,
  category TEXT CHECK (category IN ('authentication', 'authorization', 'encryption', 'session', 'headers', 'cors', 'rate_limiting', 'logging', 'compliance')),
  is_sensitive BOOLEAN DEFAULT FALSE,     -- If true, value should be masked in logs
  last_changed_by UUID REFERENCES public.profiles(id),
  last_changed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO public.security_config (config_key, config_value, config_type, description, category) VALUES
  ('session.max_age_hours', '24', 'number', 'Maximum session duration in hours', 'session'),
  ('session.idle_timeout_minutes', '30', 'number', 'Session idle timeout in minutes', 'session'),
  ('session.max_concurrent', '5', 'number', 'Maximum concurrent sessions per user', 'session'),
  ('auth.mfa_required_admin', 'true', 'boolean', 'Require MFA for admin users', 'authentication'),
  ('auth.password_min_length', '8', 'number', 'Minimum password length', 'authentication'),
  ('auth.lockout_threshold', '5', 'number', 'Failed attempts before lockout', 'authentication'),
  ('auth.lockout_duration_min', '30', 'number', 'Lockout duration in minutes', 'authentication'),
  ('auth.require_email_verification', 'true', 'boolean', 'Require email verification', 'authentication'),
  ('encryption.algorithm', 'AES-256-GCM', 'string', 'Default encryption algorithm', 'encryption'),
  ('encryption.key_rotation_days', '90', 'number', 'Key rotation interval in days', 'encryption'),
  ('headers.csp_enabled', 'true', 'boolean', 'Content Security Policy enabled', 'headers'),
  ('headers.hsts_enabled', 'true', 'boolean', 'HTTP Strict Transport Security enabled', 'headers'),
  ('cors.allowed_origins', '["http://localhost:5173"]', 'json', 'Allowed CORS origins', 'cors'),
  ('logging.retention_days', '365', 'number', 'Audit log retention in days', 'logging'),
  ('logging.pii_masking', 'true', 'boolean', 'Mask PII in logs', 'logging'),
  ('compliance.data_retention_days', '730', 'number', 'Default data retention period', 'compliance'),
  ('compliance.gdpr_enabled', 'true', 'boolean', 'GDPR compliance features enabled', 'compliance'),
  ('compliance.breach_notification_hours', '72', 'number', 'Data breach notification deadline', 'compliance');

-- =============================================
-- A06:2021 - VULNERABLE COMPONENTS TRACKING
-- ISO 27001: A.12.6 Technical vulnerability management
-- =============================================

CREATE TABLE public.dependency_audit (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  package_name TEXT NOT NULL,
  current_version TEXT NOT NULL,
  latest_version TEXT,
  ecosystem TEXT CHECK (ecosystem IN ('npm', 'pip', 'supabase', 'system')),
  has_known_vulnerabilities BOOLEAN DEFAULT FALSE,
  vulnerability_severity TEXT CHECK (vulnerability_severity IN ('none', 'low', 'medium', 'high', 'critical')),
  cve_ids TEXT[],
  remediation TEXT,
  last_checked_at TIMESTAMPTZ DEFAULT NOW(),
  scanned_by TEXT DEFAULT 'manual',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- A08:2021 - SOFTWARE & DATA INTEGRITY
-- ISO 27001: A.14.2 Security in development
-- =============================================

-- Data integrity checksums
CREATE TABLE public.data_integrity_checksums (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  table_name TEXT NOT NULL,
  record_id UUID NOT NULL,
  checksum TEXT NOT NULL,                -- SHA-256 hash of critical fields
  fields_hashed TEXT[] NOT NULL,         -- Which fields are included
  verified_at TIMESTAMPTZ DEFAULT NOW(),
  is_valid BOOLEAN DEFAULT TRUE,
  tamper_detected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- A10:2021 - SSRF PREVENTION
-- ISO 27001: A.13.1 Network security management
-- =============================================

-- URL allowlist for external requests
CREATE TABLE public.url_allowlist (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  domain TEXT NOT NULL,
  path_pattern TEXT DEFAULT '/*',
  is_active BOOLEAN DEFAULT TRUE,
  purpose TEXT,
  approved_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO public.url_allowlist (domain, purpose) VALUES
  ('hfduyehriemnfgkecmtj.supabase.co', 'Supabase API'),
  ('api.supabase.co', 'Supabase Management API'),
  ('fonts.googleapis.com', 'Google Fonts CDN'),
  ('fonts.gstatic.com', 'Google Fonts Assets');

-- =============================================
-- ISO 27001 COMPLIANCE TRACKING
-- =============================================

-- Compliance control register
CREATE TABLE public.iso_compliance_controls (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  control_id TEXT UNIQUE NOT NULL,       -- e.g., 'A.5.1.1', 'A.9.2.1'
  control_name TEXT NOT NULL,
  control_description TEXT NOT NULL,
  iso_section TEXT NOT NULL,             -- e.g., 'A.5 Information Security Policies'
  
  -- Implementation status
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'implementing', 'implemented', 'monitoring', 'non_applicable')),
  implementation_details TEXT,
  
  -- Evidence
  evidence_type TEXT,
  evidence_location TEXT,
  
  -- Assessment
  last_assessed_at TIMESTAMPTZ,
  assessed_by UUID REFERENCES public.profiles(id),
  assessment_result TEXT CHECK (assessment_result IN ('conforming', 'minor_finding', 'major_finding', 'opportunity')),
  
  -- Risk
  risk_level TEXT CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert ISO 27001 Annex A controls relevant to SafeDrive
INSERT INTO public.iso_compliance_controls (control_id, control_name, control_description, iso_section, status, implementation_details) VALUES
  ('A.5.1.1', 'Policies for information security', 'Set of policies approved by management for information security', 'A.5 Security Policies', 'implemented', 'Security policies defined in data_classification and security_config tables'),
  ('A.6.1.2', 'Segregation of duties', 'Conflicting duties separated to reduce unauthorized modification', 'A.6 Organization of IS', 'implemented', 'Role-based access control via permissions table with admin/renter/rentee segregation'),
  ('A.8.2.1', 'Classification of information', 'Information classified in terms of value and sensitivity', 'A.8 Asset Management', 'implemented', 'Data classification register in data_classification table'),
  ('A.9.1.1', 'Access control policy', 'Access control policy established and reviewed', 'A.9 Access Control', 'implemented', 'RBAC permissions matrix and Supabase RLS policies'),
  ('A.9.2.1', 'User registration and de-registration', 'Formal user registration and de-registration process', 'A.9 Access Control', 'implemented', 'Supabase Auth with email verification and profile creation trigger'),
  ('A.9.2.3', 'Management of privileged access', 'Privileged access rights restricted and controlled', 'A.9 Access Control', 'implemented', 'Admin role restricted by RLS and frontend route guards'),
  ('A.9.4.1', 'Information access restriction', 'Access to information restricted per access control policy', 'A.9 Access Control', 'implemented', 'Row Level Security on all 8+ core tables'),
  ('A.9.4.2', 'Secure log-on procedures', 'Controlled log-on procedure for system access', 'A.9 Access Control', 'implemented', 'Failed login tracking, account lockout, rate limiting'),
  ('A.10.1.1', 'Policy on use of cryptographic controls', 'Policy on use of cryptographic controls', 'A.10 Cryptography', 'implemented', 'Encryption key registry, data at rest via Supabase, HTTPS in transit'),
  ('A.12.4.1', 'Event logging', 'Event logs recording user activities and security events', 'A.12 Operations Security', 'implemented', 'Comprehensive security_audit_logs table with 50+ event types'),
  ('A.12.4.3', 'Administrator and operator logs', 'Admin activities logged and protected', 'A.12 Operations Security', 'implemented', 'All admin actions logged in security_audit_logs with admin prefix'),
  ('A.13.1.1', 'Network controls', 'Networks managed and controlled to protect information', 'A.13 Communications Security', 'implemented', 'URL allowlisting, SSRF prevention, CORS configuration'),
  ('A.14.2.5', 'Secure system engineering principles', 'Principles for engineering secure systems', 'A.14 System Acquisition', 'implemented', 'Input validation rules, parameterized queries via Supabase SDK, CSP headers'),
  ('A.16.1.1', 'Responsibilities and procedures', 'Management responsibilities for incident response', 'A.16 Incident Management', 'implemented', 'security_incidents table with 10-Code classification and incident workflow'),
  ('A.16.1.2', 'Reporting information security events', 'Security events reported through management channels', 'A.16 Incident Management', 'implemented', 'Automated incident detection and reporting via security functions'),
  ('A.16.1.5', 'Response to incidents', 'Incidents responded to in accordance with procedures', 'A.16 Incident Management', 'implemented', 'Incident lifecycle: open→investigating→containing→eradicating→resolving→closed'),
  ('A.18.1.3', 'Protection of records', 'Records protected from loss, destruction, falsification', 'A.18 Compliance', 'implemented', 'Data integrity checksums, audit log immutability, retention policies');

-- =============================================
-- ENHANCED RLS POLICIES FOR SECURITY TABLES
-- =============================================

ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_control_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_classification ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.encryption_key_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.input_validation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.injection_attempt_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.failed_login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_lockouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limit_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dependency_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_integrity_checksums ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.url_allowlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.iso_compliance_controls ENABLE ROW LEVEL SECURITY;

-- Admin-only access for security tables
CREATE POLICY "Only admins can read permissions" ON public.permissions
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin')));

CREATE POLICY "Only admins can read access logs" ON public.access_control_logs
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin')));

CREATE POLICY "System can insert access logs" ON public.access_control_logs
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Only admins can read data classification" ON public.data_classification
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin')));

CREATE POLICY "Only admins can read encryption registry" ON public.encryption_key_registry
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin'));

CREATE POLICY "Anyone can read validation rules" ON public.input_validation_rules
  FOR SELECT USING (true);

CREATE POLICY "Only admins can read injection logs" ON public.injection_attempt_logs
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin')));

CREATE POLICY "System can insert injection logs" ON public.injection_attempt_logs
  FOR INSERT WITH CHECK (true);

CREATE POLICY "System can insert failed logins" ON public.failed_login_attempts
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Admins can read failed logins" ON public.failed_login_attempts
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin')));

CREATE POLICY "Users can view own lockouts" ON public.account_lockouts
  FOR SELECT USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin')));

CREATE POLICY "Users can view own sessions" ON public.user_sessions
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Admins can manage sessions" ON public.user_sessions
  FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin')));

CREATE POLICY "Anyone can read password policies" ON public.password_policies
  FOR SELECT USING (true);

CREATE POLICY "Admins can read audit logs" ON public.security_audit_logs
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin')));

CREATE POLICY "System can insert audit logs" ON public.security_audit_logs
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Admins can manage incidents" ON public.security_incidents
  FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin')));

CREATE POLICY "Anyone can read rate limits config" ON public.rate_limits
  FOR SELECT USING (true);

CREATE POLICY "System can manage rate tracking" ON public.rate_limit_tracking
  FOR ALL USING (true);

CREATE POLICY "Admins can read security config" ON public.security_config
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin')));

CREATE POLICY "Admins can read dependency audit" ON public.dependency_audit
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin')));

CREATE POLICY "Admins can manage integrity checksums" ON public.data_integrity_checksums
  FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin')));

CREATE POLICY "Admins can read URL allowlist" ON public.url_allowlist
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin')));

CREATE POLICY "Admins can read compliance controls" ON public.iso_compliance_controls
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin')));

-- Vehicles delete policy (missing from original schema)
CREATE POLICY "Owners can delete own vehicles" ON public.vehicles
  FOR DELETE USING (owner_id = auth.uid());

-- Notifications insert policy (allow system/authenticated inserts)
CREATE POLICY "Authenticated users can create notifications" ON public.notifications
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- =============================================
-- SECURITY HELPER FUNCTIONS
-- =============================================

-- Function to log security audit events
CREATE OR REPLACE FUNCTION public.log_security_event(
  p_user_id UUID,
  p_event_type TEXT,
  p_description TEXT,
  p_resource_type TEXT DEFAULT NULL,
  p_resource_id UUID DEFAULT NULL,
  p_severity TEXT DEFAULT 'info',
  p_owasp TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_log_id UUID;
  v_user_email TEXT;
  v_user_role TEXT;
BEGIN
  -- Get user info
  SELECT email, role INTO v_user_email, v_user_role 
  FROM public.profiles WHERE id = p_user_id;
  
  INSERT INTO public.security_audit_logs (
    user_id, user_email, user_role, event_type, event_description,
    resource_type, resource_id, severity, owasp_category, metadata
  ) VALUES (
    p_user_id, v_user_email, v_user_role, p_event_type, p_description,
    p_resource_type, p_resource_id, p_severity, p_owasp, p_metadata
  ) RETURNING id INTO v_log_id;
  
  RETURN v_log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check and enforce rate limits
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_identifier TEXT,
  p_endpoint TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  v_limit RECORD;
  v_current_count INTEGER;
BEGIN
  -- Get the rate limit config for this endpoint
  SELECT * INTO v_limit FROM public.rate_limits 
  WHERE endpoint = p_endpoint AND is_active = TRUE LIMIT 1;
  
  IF NOT FOUND THEN RETURN TRUE; END IF;
  
  -- Count requests in the current window
  SELECT COALESCE(SUM(request_count), 0) INTO v_current_count
  FROM public.rate_limit_tracking
  WHERE identifier = p_identifier 
    AND endpoint = p_endpoint 
    AND window_end > NOW();
  
  IF v_current_count >= v_limit.max_requests THEN
    -- Log the rate limit exceeded event
    PERFORM public.log_security_event(
      NULL, 'security.rate_limit_exceeded',
      'Rate limit exceeded for ' || p_endpoint || ' by ' || p_identifier,
      NULL, NULL, 'warning', NULL,
      jsonb_build_object('endpoint', p_endpoint, 'identifier', p_identifier, 'count', v_current_count)
    );
    RETURN FALSE;
  END IF;
  
  -- Track this request
  INSERT INTO public.rate_limit_tracking (identifier, endpoint, window_end)
  VALUES (p_identifier, p_endpoint, NOW() + (v_limit.window_seconds || ' seconds')::INTERVAL)
  ON CONFLICT DO NOTHING;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to create a security incident
CREATE OR REPLACE FUNCTION public.create_security_incident(
  p_ten_code TEXT,
  p_category TEXT,
  p_severity TEXT,
  p_title TEXT,
  p_description TEXT,
  p_reported_by UUID DEFAULT NULL,
  p_affected_systems TEXT[] DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_incident_id UUID;
  v_ten_code_desc TEXT;
BEGIN
  -- Map 10-codes to descriptions
  v_ten_code_desc := CASE p_ten_code
    WHEN '10-4' THEN 'Acknowledged - Under Review'
    WHEN '10-7' THEN 'Service Unavailable - System Down'
    WHEN '10-8' THEN 'Service Restored - System Up'
    WHEN '10-10' THEN 'Active Attack - Breach in Progress'
    WHEN '10-20' THEN 'Source Identified - Location Traced'
    WHEN '10-32' THEN 'High Severity Threat Detected'
    WHEN '10-33' THEN 'EMERGENCY - Critical Incident'
    WHEN '10-89' THEN 'Data Breach Threat'
    WHEN '10-90' THEN 'System-Wide Alert'
    ELSE 'Unknown Code'
  END;

  INSERT INTO public.security_incidents (
    ten_code, ten_code_description, category, severity,
    title, description, affected_systems, reported_by,
    report_source, status
  ) VALUES (
    p_ten_code, v_ten_code_desc, p_category, p_severity,
    p_title, p_description, p_affected_systems, p_reported_by,
    CASE WHEN p_reported_by IS NULL THEN 'automated' ELSE 'admin_detection' END,
    'open'
  ) RETURNING id INTO v_incident_id;
  
  -- Automatically log the incident as a critical audit event
  PERFORM public.log_security_event(
    p_reported_by,
    CASE 
      WHEN p_severity = 'P1-Critical' THEN 'security.suspicious_activity'
      ELSE 'security.suspicious_activity'
    END,
    'Security incident created: ' || p_title,
    'security_incident', v_incident_id,
    CASE 
      WHEN p_severity IN ('P1-Critical', 'P2-High') THEN 'critical'
      WHEN p_severity = 'P3-Medium' THEN 'warning'
      ELSE 'info'
    END,
    NULL,
    jsonb_build_object('ten_code', p_ten_code, 'category', p_category, 'severity', p_severity)
  );

  RETURN v_incident_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Auto-update security incidents updated_at
CREATE TRIGGER set_incidents_updated_at BEFORE UPDATE ON public.security_incidents
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_compliance_updated_at BEFORE UPDATE ON public.iso_compliance_controls
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- =============================================
-- DATA CLEANUP / RETENTION FUNCTION
-- ISO 27001: A.8.3 Media handling
-- =============================================

CREATE OR REPLACE FUNCTION public.cleanup_expired_data()
RETURNS void AS $$
BEGIN
  -- Clean up expired rate limit tracking
  DELETE FROM public.rate_limit_tracking WHERE window_end < NOW() - INTERVAL '1 hour';
  
  -- Clean up old failed login attempts (keep 90 days)
  DELETE FROM public.failed_login_attempts WHERE created_at < NOW() - INTERVAL '90 days';
  
  -- Revoke expired sessions
  UPDATE public.user_sessions SET is_active = FALSE, revoked_at = NOW(), revoke_reason = 'expired'
  WHERE expires_at < NOW() AND is_active = TRUE;
  
  -- Clean up expired account lockouts
  UPDATE public.account_lockouts SET is_active = FALSE, unlocked_at = NOW()
  WHERE unlock_at < NOW() AND is_active = TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

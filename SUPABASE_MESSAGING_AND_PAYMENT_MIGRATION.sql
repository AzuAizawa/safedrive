-- =============================================================
-- SafeDrive Messaging System Migration
-- Run this in Supabase SQL Editor
-- =============================================================

-- 1. Conversations table (one per booking)
CREATE TABLE IF NOT EXISTS conversations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
    participant_one_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    participant_two_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    last_message TEXT,
    last_message_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Messages table
CREATE TABLE IF NOT EXISTS messages (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    content TEXT NOT NULL CHECK (char_length(content) <= 1000),
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Add payment columns to bookings table
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'pending', 'paid', 'refunded'));
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_link_id TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS insurance_opted BOOLEAN DEFAULT FALSE;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS insurance_amount NUMERIC(10,2) DEFAULT 0;

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_conversations_participant_one ON conversations(participant_one_id);
CREATE INDEX IF NOT EXISTS idx_conversations_participant_two ON conversations(participant_two_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);

-- 5. Enable RLS
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- 6. RLS Policies: participants can only see their own conversations
DROP POLICY IF EXISTS "Participants can view conversations" ON conversations;
CREATE POLICY "Participants can view conversations"
    ON conversations FOR SELECT
    USING (
        participant_one_id = auth.uid() OR participant_two_id = auth.uid()
    );

DROP POLICY IF EXISTS "Participants can create conversations" ON conversations;
CREATE POLICY "Participants can create conversations"
    ON conversations FOR INSERT
    WITH CHECK (
        participant_one_id = auth.uid() OR participant_two_id = auth.uid()
    );

DROP POLICY IF EXISTS "Participants can update conversations" ON conversations;
CREATE POLICY "Participants can update conversations"
    ON conversations FOR UPDATE
    USING (
        participant_one_id = auth.uid() OR participant_two_id = auth.uid()
    );

-- 7. RLS Policies: only conversation participants can see messages
DROP POLICY IF EXISTS "Participants can view messages" ON messages;
CREATE POLICY "Participants can view messages"
    ON messages FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM conversations c
            WHERE c.id = conversation_id
            AND (c.participant_one_id = auth.uid() OR c.participant_two_id = auth.uid())
        )
    );

DROP POLICY IF EXISTS "Participants can send messages" ON messages;
CREATE POLICY "Participants can send messages"
    ON messages FOR INSERT
    WITH CHECK (
        sender_id = auth.uid() AND
        EXISTS (
            SELECT 1 FROM conversations c
            WHERE c.id = conversation_id
            AND (c.participant_one_id = auth.uid() OR c.participant_two_id = auth.uid())
        )
    );

DROP POLICY IF EXISTS "Participants can mark messages read" ON messages;
CREATE POLICY "Participants can mark messages read"
    ON messages FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM conversations c
            WHERE c.id = conversation_id
            AND (c.participant_one_id = auth.uid() OR c.participant_two_id = auth.uid())
        )
    );

-- 8. Enable Realtime for messages
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE conversations;

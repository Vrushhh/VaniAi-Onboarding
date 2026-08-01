-- Migration: add theme column to profiles table
-- File suggestion: supabase/migrations/20260719232000_add_theme_to_profiles.sql

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS theme TEXT
  CONSTRAINT profiles_theme_check CHECK (theme IN ('light', 'dark', 'system')) DEFAULT 'system';

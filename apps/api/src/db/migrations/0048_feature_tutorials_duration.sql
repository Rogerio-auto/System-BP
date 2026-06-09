-- Migration: 0048_feature_tutorials_duration
-- Adiciona coluna duration_seconds (nullable) à tabela feature_tutorials.
-- Norma: docs/21-tutoriais-em-video.md §4 — campo omitido em F12-S01.
-- Exibido como badge de duração no ⓘ/drawer (F12-S04).

ALTER TABLE "feature_tutorials" ADD COLUMN "duration_seconds" integer;

# Vanteloq Advisory Design

**Date:** 2026-10-13

## Purpose

Vanteloq Advisory is the human advisory and implementation service inside the Vanteloq brand. The page must let an owner-led business understand the offer within seconds, establish who will help them, explain a practical engagement, and provide one secure inquiry path.

Vanteloq Workspace remains the software product. Advisory may be used with or without a Workspace subscription. Lexedge is not presented as a current parallel brand. The preserved film is labelled as the origin of the advisory work.

## Customer Journey

1. Understand the offer and location.
2. Meet the three-person team.
3. Recognize the business question Advisory can help answer.
4. Understand the five-step method.
5. See the founder story and preserved film.
6. Understand how Advisory relates to Vanteloq Workspace.
7. Resolve four common questions.
8. Submit one secure advisory inquiry or book a clarity call.
9. Follow Vanteloq through its existing social profiles.

## Information Architecture

- Hero: Vanteloq Advisory, one value proposition, one primary action and one secondary anchor.
- Team: Zak Mohamed, Ahmed Yassin and Hussien Issa in that order, with approved titles and concise descriptions.
- Advisory help: Growth and Operations, Analytics and Financial Intelligence, Implementation and Workspace Setup.
- Method: Understand, Diagnose, Decide, Implement and Review.
- Origin: founder story plus the existing introduction film with a clear Lexedge transition note.
- Workspace relationship: two compact cards explaining independent Advisory and Advisory plus Workspace.
- FAQ: four closed native details elements.
- Contact: secured existing inquiry pipeline with an explicit advisory purpose.
- Social: existing accessible social links and a link to the full social hub.

## Content Boundaries

- Do not imply a professional accounting designation, audit service, legal service or other unverified credential.
- Do not promise revenue, savings or a fixed business result.
- Do not position VantaTalk as the advisory service.
- Do not show the retired Lexedge logo or the old dual-brand family artwork.
- The founder story may state that Hussien started a retail business with his brother, helped scale it, and conceived and developed Vanteloq. Do not invent revenue, store count, location or growth claims.
- The film caption must state that the advisory work began as Lexedge Consulting and is now part of Vanteloq.

## Visual System

- Reuse Vanteloq's current logo, Geist typography, dark and light appearance tokens, electric blue accent and restrained glass surfaces.
- Keep the background calm with one subtle glow. Do not add moving decorative backgrounds, carousels or dense dashboards.
- Use one card radius, consistent controls, 44 pixel minimum targets, readable muted copy, and a content width near 1,200 pixels.
- Team cards use responsive WebP sources and a consistent 4:5 crop.
- The film is click-to-play, 16:9, native controls, `preload="none"`, a real poster and no autoplay.
- Mobile layouts are single column, with full-width primary actions and no horizontal overflow from 320 pixels upward.

## Form Contract

- Purpose: `advisory`.
- Required: name, email, advisory context and consent.
- Optional: business name and phone.
- Submit label: Start the Conversation.
- Consent explicitly covers a Vanteloq Advisory response and does not subscribe the visitor to marketing.
- Preserve Turnstile verification, rate limiting, bounded validation, fixed recipient, Resend idempotency and delivery receipt checks.
- Success must show the server reference. Actual mailbox receipt is a separate production acceptance check.

## Acceptance Criteria

- The route is `/advisory`, has one H1, route metadata, canonical URL and Service JSON-LD.
- The global public navigation and footer expose Advisory without crowding the header.
- Team assets, film and social destinations are preserved and functional.
- The page contains no Lexedge logo and no VantaTalk call-to-action.
- All primary page actions resolve to the contact section.
- Four FAQs use accessible native details elements.
- Focus visibility, contrast, reduced motion and 200 percent zoom remain usable.
- Focused tests, lint, typecheck, production build and responsive browser QA pass before publication.


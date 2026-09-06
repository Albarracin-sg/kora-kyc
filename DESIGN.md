# Kora Mobile Design System and Redesign Brief

## Purpose

Redesign Kora as a reassuring private-identity companion for iOS and Android. The app helps an authenticated person create an account, complete a KYC verification, understand its outcome, review permitted identity data, and privately revisit prior terminal verifications.

This is a visual and information-architecture redesign brief, not permission to change security, API contracts, or KYC decision logic. Screens, hierarchy, navigation patterns, and component composition may change when the functional rules below remain true.

## Non-negotiable functional rules

| Area | Rule to preserve |
| --- | --- |
| Authentication | Keep welcome, registration, login, restored session, profile, and secure logout. Do not reveal authenticated views before a valid session is restored. |
| KYC state machine | Preserve `CREATED → DOCUMENT_UPLOADED → SELFIE_UPLOADED → VALIDATING`; terminal outcomes are `APPROVED`, `REJECTED`, `NEEDS_REVIEW`, and `PROCESSING_FAILED`. Terminal outcomes must never be presented as editable or silently changed. |
| Fail closed | Missing evidence, invalid images, unavailable processing, invalid provider output, or quality failure must lead to a safe non-approval outcome. Never imply approval, completion, or a successful match when the backend did not return one. |
| Consent | Before a flow that uses configured external processing, show the informed-consent statement and require an explicit, accessible opt-in. Explain what may be sent, why, and that the person can cancel before continuing. No preselected consent. |
| Evidence | Support document capture as `FRONT` then `BACK`, or a mutually exclusive `COMBINED` capture when that flow is available. A combined document must not coexist visually or functionally with separate front/back evidence. Re-capturing a side replaces that side. |
| Face comparison | Only show face similarity when the response establishes a valid face-comparison result for an approved match or a below-threshold rejection. Never render a generic score, a health-like metric, or a similarity indicator for quality failures, review outcomes, unavailable processing, or missing data. |
| Privacy | KYC history, detail records, extracted document fields, and media are owner-only authenticated content. Media must remain private, fetched only through authenticated access, and disappear when access or retention has expired. Do not expose direct object URLs, share affordances, screenshots, caches, or PII in logs. |
| Retention | Explain that private history is available for the product-defined retention window (currently 90 days) without exposing implementation details. Empty or expired history is normal and must not look like an error. |
| Scope | Do not claim liveness detection, document authenticity guarantees, medical insight, identity assurance beyond the returned KYC outcome, or local-only processing when configured remote processing can apply. |

## Design direction: the private identity journal

Create a **warm editorial privacy desk**: cream paper as the calm working surface, a confident Kora-green identity card as the emotional focal point, and a near-black lower action dock as the security anchor. The memorable motif is a **segmented confidence path**—a soft pastel ring or arc that visualizes KYC progress stages, never a personal score. Its segments represent evidence milestones (account, document, selfie, decision) and use status-dependent fills.

This borrows the supplied warmth, rounded dark chips, strong central focal point, and bottom black panel, but it must feel unmistakably like Kora: careful, informed, and private—not clinical, fitness-oriented, or gamified. Prefer tactile editorial blocks, restrained grain, and precise labels over dashboards, charts, or medical metaphors.

### Visual principles

- Make the current next action unmistakable; one screen, one primary decision.
- Pair warmth with boundaries: light surfaces for clarity, ink panels for security-critical actions.
- Use large typography and generous empty space to reduce stress during capture and outcome review.
- Treat the progress ring as a process map, never a score, gauge, biometric assessment, or approval predictor.
- Use status color as a secondary signal; every status must also have a text label and descriptive explanation.

## Foundations

### Color tokens

| Token | Value | Use |
| --- | --- | --- |
| `canvas` | `#FFF8F0` | Primary cream background |
| `canvas-muted` | `#F4E9DD` | Quiet grouped areas and disabled surfaces |
| `ink` | `#161412` | Main text, dark dock, high-contrast actions |
| `ink-soft` | `#332E2A` | Secondary dark surfaces and chips |
| `kora-green` | `#00DB90` | Exact dominant logo color; identity focal card, primary brand emphasis, and recognizable Kora moments |
| `kora-green-deep` | `#007A4F` | High-contrast green text/icon accent and pressed-state support; not body text on cream |
| `apricot` | `#F6C78C` | Progress segment and attention accent |
| `lilac` | `#CFC5F3` | Progress segment and supporting highlight |
| `mint` | `#A8DEC7` | Quiet progress segment and approved-state support; subordinate to Kora green |
| `blue` | `#A9D6F5` | Informational support accent |
| `success` | `#176B4B` | Approved status with text label |
| `review` | `#8A5A08` | Needs-review status with text label |
| `danger` | `#A43842` | Rejected/failed status with text label |
| `border` | `#DCCEC0` | Dividers and input borders |
| `text-muted` | `#6C625A` | Supporting copy; maintain accessible contrast |

Do not use color alone for status. Validate all text/background pairs at WCAG AA (4.5:1 normal text, 3:1 large text and controls).

### Typography

Use a distinctive editorial display face with a highly legible sans-serif body face available to Expo. Recommended pairing: **Newsreader SemiBold** for display numerals/headlines and **DM Sans** for body, labels, forms, and controls. If those fonts are not available, use a licensed/app-bundled equivalent; do not fall back to a generic system-only aesthetic.

| Style | Size / line height | Weight / use |
| --- | --- | --- |
| Display | 44–52 / 48–56 | Semibold; welcome, status outcome, one key date/metric |
| Title | 30–36 / 36–42 | Semibold; screen titles |
| Section | 20–24 / 26–30 | Semibold; card sections |
| Body | 16 / 24 | Regular; instructions and explanations |
| Label | 12–13 / 16 | Medium, uppercase optional, 0.08em tracking; metadata only |
| Button | 16 / 20 | Bold; clear action verbs |

### Layout, shape, and elevation

- Spacing scale: `4, 8, 12, 16, 24, 32, 48`.
- Screen gutters: 20–24 px on phones; keep reading columns at 640 px maximum on larger layouts.
- Radius: 12 px small, 20 px cards, 28 px feature panels, 999 px chips and ring ends.
- Elevation: mostly flat. Use a 1 px warm border by default; feature Kora-green cards may use `0 12 32 rgba(0, 91, 60, .16)` equivalent. Avoid stacked cards and heavy floating shadows.
- Add a subtle paper-grain or halftone texture at low opacity to cream areas only. Never overlay texture on camera previews, document media, readable text, or form fields.

### Motion

- Screen arrival: 180–240 ms fade and 8 px upward settle; stagger grouped content by 40–60 ms.
- Ring progress: animate only after status is known; 450–600 ms ease-out. Do not make it spin indefinitely.
- Capture shutter, upload, and validation must have explicit textual progress states, not motion alone.
- Respect Reduce Motion: replace transforms/ring animation with instant state updates.
- Never animate sensitive images into view from off-screen or use celebratory effects for an approval.

## Component system

| Component | Visual behavior | Functional behavior |
| --- | --- | --- |
| `KoraMark` | Compact wordmark/seal in exact Kora green on cream, or cream on ink | Decorative label unless it navigates; then expose an accessible label |
| `EditorialHeader` | Eyebrow, title, optional concise context, back control | Back controls have at least 44×44 px target |
| `IdentityHero` | Kora-green feature card with large status title and segmented process ring | Shows a status label and explanation; ring is a labeled process map |
| `StatusChip` | Dark rounded chip with icon, text, and semantic status | Includes status name in accessible label; never color-only |
| `PrimaryAction` | Full-width ink button with cream text | One primary action per decision area; visible disabled reason where relevant |
| `SecondaryAction` | Ink outline or text action | Never visually equal to destructive/logout actions |
| `BottomActionDock` | Persistent or anchored ink panel with the current main action | Respect safe area and keyboard; do not obscure scrollable content |
| `Field` | Cream/white input with dark label and clear error state | Email/password behavior, keyboard type, secure entry, errors, and submit blocking remain intact |
| `ConsentBlock` | Plain-language disclosure, explicit checkbox, provider/privacy note | Checkbox is not preselected; submit remains blocked until required consent |
| `ProgressPath` | Four labeled pastel segments: Account, Document, Selfie, Decision | Reflect actual returned phase only; mark terminal outcome separately from progress |
| `CaptureFrame` | High-contrast document rectangle or portrait oval over live camera | Preserve rear camera for documents, front camera for selfie, camera readiness, retry, cancel, safe-size checks, and upload errors |
| `EvidenceTile` | Labeled, private thumbnail container with side marker | `FRONT`, `BACK`, `COMBINED`, and selfie labels; no public sharing/save controls |
| `PrivateRecordCard` | Dated history item with status chip and optional valid similarity text | Opens only its owner-scoped detail; supports pagination/load more |
| `IdentityFields` | Two-column editorial definition list that collapses to one column | Render only API-provided extracted fields; preserve unavailable values without inventing data |
| `PrivacyNotice` | Small locked-note treatment | Explains private access and retention without claiming more than the system guarantees |
| `EmptyState` / `ErrorState` | Quiet illustration-free text block and clear recovery action | Distinguish no data, expired content, offline/API error, permission denial, and unavailable processing |

## Views and required states

All screens must support loading, error, disabled, and screen-reader states where applicable. Preserve the existing routes or map them to equivalent destinations.

### Unauthenticated

1. **Welcome** — editorial introduction, privacy promise, Register and Log in actions. Do not make unverified security claims.
2. **Register** — email/password fields, password minimum guidance, inline validation, submit state, API error, and route to login.
3. **Login** — email/password fields, secure entry, submit state, API error, and route to registration.
4. **Session restoration** — neutral, non-PII loading view while secure tokens and account state are restored; do not flash authenticated data before completion.

### Identity hub and profile

5. **Home / Identity hub** — the primary redesign canvas. Use `IdentityHero` with the current state, its plain-language explanation, `ProgressPath`, and one contextual next action. Include routes to Profile, private History, and manual status refresh. A concise limitation note must remain: Kora does not perform liveness detection or guarantee document authenticity.
   - No active verification: invite the person to start.
   - `CREATED`, document, selfie, and validating phases: show real next step, not success styling.
   - Terminal outcomes: show exact backend-aligned outcome and a clear new-verification path.
6. **Profile** — authenticated email/account creation metadata, current identity status, extracted document data when returned, return-to-hub action, and logout. Treat document fields as sensitive; avoid oversized display or automatic copying.

### KYC start and capture

7. **Start verification** — explain the document + selfie process in four concise steps, private-storage note, cancel route, configuration loading/retry, and required external-processing consent when the API says it applies. Display front/back as the default sequence and present combined capture only as an explicit alternative supported by the flow.
8. **Document capture** — full-height camera experience with progress path, rear-camera instruction, framing guide, readiness status, capture/upload progress, retry, cancel, and clear quality guidance. Support these evidence states:
   - `FRONT` needed: capture the front.
   - `BACK` needed after a front: capture the back.
   - `COMBINED` alternative: label it as both sides in one permitted image and suppress the separate front/back path.
   - Existing evidence: show only the relevant next capture; never imply that a front-only document is complete.
9. **Selfie capture** — front camera, portrait framing guide, single-person and lighting guidance, readiness/retry/cancel/upload states, then transition to processing. Avoid language or visuals that imply liveness detection.
10. **Camera permission and unavailable camera** — explain why camera access is needed, provide Allow, Retry when appropriate, and Cancel. Permission denial must not strand the person.
11. **Capture success transition** — brief confirmation after each successful upload: Front saved → Back next; Back saved → Selfie next; Selfie saved → validation next. It is confirmation of storage, not verification approval.

### Processing and result

12. **Processing / result** — one adaptable result view with explicit state variants:
   - No active verification: direct start action.
   - `SELFIE_UPLOADED`: “ready to validate” primary action.
   - `VALIDATING`: readable in-progress state, periodic refresh behavior, and no fake percentage or expected-time promise.
   - `APPROVED`: verified outcome, private evidence card, and document fields returned by the API.
   - `REJECTED`: non-approved explanation and a new-verification action.
   - `NEEDS_REVIEW`: safe-review explanation. For capture-quality reason codes, direct the person to take new photos and keep the reason-specific guidance.
   - `PROCESSING_FAILED`: clearly state that verification could not be safely concluded; preserve provider-unavailable messaging when returned.
   - Terminal outcomes: offer a confirm-before-restart interaction that explains prior verification remains in private history.

13. **Private evidence / digital identity card** — show document side(s) and selfie only for the authenticated current terminal verification. A valid face similarity may appear with its explanatory verdict only for approved or below-threshold rejected comparisons. Do not use the segmented ring as a numeric biometric visualization.

### Private history

14. **History list** — authenticated, owner-only list of terminal verifications retained within the available window. Each record includes a formatted finalization date, status chip, and valid similarity only when supplied. Include initial loading, empty history, API error/retry, paginated “load more,” and return navigation. Do not show document numbers, names, thumbnails, reason codes, or media in the list.
15. **History detail** — authenticated, owner-only record view. Show finalization date, status/explanation, allowed extracted document fields, and labeled private evidence tiles retrieved through authenticated media access. Show similarity only under the same valid-result rule. Include loading, expired/not-found/unauthorized-safe error states, media loading/failure placeholders, and back navigation. No share, export, download, screenshot prompt, public link, or media URL is permitted.

## Navigation

- Use a simple authenticated stack with a hub as its root: Hub → Start → Document → Selfie → Result; Hub → Profile; Hub → History → History detail.
- Unauthenticated stack: Welcome → Register or Login. A completed login/registration resolves into the authenticated hub.
- Preserve back behavior without allowing a person to bypass required evidence steps. Canceling capture returns to the hub without fabricating state.
- The current next KYC action should be reachable from the hub in one tap. History is a secondary private destination, not an unauthenticated tab.
- Use native back gestures/buttons where safe; always provide a visible back control on deep screens.

## Accessibility and responsive behavior

- Design for 320 px to large-phone widths, portrait first, with safe-area-aware bottom dock and camera controls. On tablets or landscape, center the content column and preserve camera preview aspect ratio rather than stretching media.
- Maintain 44×44 px minimum touch targets, 16 px minimum body text, dynamic type support, logical focus order, visible keyboard focus, and sufficient spacing for screen magnification.
- Use semantic roles and state: buttons, checkboxes, progress bar/status, alerts, and live regions for camera/readiness/upload/validation updates.
- Every icon needs a text alternative or must be decorative. Every camera frame needs an instruction outside the visual frame.
- Do not depend on gestures, color, motion, or the ring alone. Ensure screen readers announce the current KYC state and the next available action.
- Support reduced motion, high contrast, and system font scaling without clipped cards, truncated errors, or unreachable dock actions.

## PII and image treatment

- Document and selfie images are sensitive visual evidence, not decoration. Never use them as backgrounds, hero imagery, marketing samples, placeholders, or blurred texture.
- Use neutral silhouette placeholders until authenticated private media loads. Avoid caches and previews outside the current protected screen; clear them when navigating away or signing out.
- Do not render raw OCR/provider responses, tokens, hashes, media URLs, request payloads, or unredacted error diagnostics.
- Do not include real identity values in demos, design mocks, screenshots, test copy, or this document. Use neutral labels such as “Document data available” in design examples.
- Any copied sensitive field must be an explicit, accessible user action and only if the existing product authorizes it; the redesign must not introduce copying, sharing, or export.

## Content and tone

Write in calm, direct, professional Spanish for the in-app experience, matching existing product language. Use short sentences and action-led labels: “Capture the front,” “Review your consent,” “Start a new verification.”

- Say what happened and what to do next; do not blame the person for a failed capture.
- Use “identity verification,” “private record,” “document,” and “photo of your face”; avoid clinical terms, diagnostic language, “health,” “wellness,” or “score.”
- Explain uncertainty honestly: “Kora could not safely complete an automated decision.”
- Avoid security hyperbole such as “100% secure,” “guaranteed,” or “fully verified forever.”

## Do / do not

**Do**

- Use the Kora-green feature card, soft segmented progress path, ink chips, and black action dock deliberately.
- Keep `#00DB90` as the unmistakable Kora cue; use warm cream and secondary pastels as support, never as competing brand primaries.
- Give terminal states distinct, respectful explanations and recovery paths.
- Make external-processing consent explicit and readable before capture starts.
- Protect history/detail/media behind the authenticated private experience.
- Preserve the existing status-dependent face-similarity conditions.

**Do not**

- Copy a health-app identity, use heart/medical icons, activity rings, body metrics, wellness language, or invented scores.
- Reintroduce pink or rose as Kora's primary identity color, or let a warm accent compete with the exact logo green.
- Convert KYC progress into a “trust score,” approval probability, or gamified streak.
- Mark a front-only document as complete, mix `COMBINED` with `FRONT`/`BACK`, or allow a selfie to substitute for document evidence.
- Reframe `NEEDS_REVIEW` or `PROCESSING_FAILED` as approval, a temporary cosmetic state, or a silent retry.
- Add public media links, sharing, downloads, unauthenticated previews, analytics screenshots, or PII-heavy notifications.

## Acceptance criteria

- [ ] The redesign has a recognizable warm editorial identity anchored by cream, exact Kora green (`#00DB90`), ink, and a labeled pastel process path—not a health or fitness aesthetic.
- [ ] Every existing destination has an equivalent screen/state: welcome, register, login, session restore, hub, profile, KYC start, document capture, selfie capture, permission/error/success capture states, processing/result, private evidence, history list, and history detail.
- [ ] The state machine and terminal outcomes are represented accurately, with fail-closed outcomes never styled or worded as success.
- [ ] Required external-processing consent is explicit, unselected by default, accessible, and blocks continuation until accepted.
- [ ] Document flow preserves front/back default, combined alternative, mutual exclusion, and accurate incomplete-evidence guidance.
- [ ] Face similarity is absent unless it is a valid returned approved or below-threshold comparison outcome.
- [ ] History and media are visibly private, authenticated-only, retention-aware, paginated where applicable, and provide safe empty/error/expired states.
- [ ] Camera, forms, loading, validation, retry, cancel, and logout flows remain operable with touch, keyboard assistive technology, dynamic type, reduced motion, and safe areas.
- [ ] No screen, mock, component, copy, or interaction introduces PII exposure, secrets, public media access, medical claims, or invented trust/biometric metrics.

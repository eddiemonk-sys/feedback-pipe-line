# Spotted Zebra — Design System

A design system for building **Spotted Zebra's new marketing website and slide decks**. It captures the H2 2026 brand direction: white-led, confident, human, with blue as the hero accent and yellow as a sparing signal. (This system is **not** for the product app UI, which uses a separate Roboto/Noto-based system.)

> **The brand in one line:** *Spot the right hire, every time.* Skills science native, AI amplified — an end-to-end hiring platform for enterprise teams.

## Sources
These informed the system. You may not have access; they are recorded for provenance.
- **Notion — Brand identity v1.2:** https://app.notion.com/p/Brand-identity-v1-2-2fa49f86254848c0b54520582349fdef
- **Notion — Design at Spotted Zebra:** https://app.notion.com/p/385dc90a479c46e1a3d94b0d655b8813
- **Google Slides — Master Deck 2026:** https://docs.google.com/presentation/d/1DsJ8SkyYPsDqYPqDMd2Me3KjldMQDAGSfGO7WTs46P8
- **Google Slides — Template v2.2:** https://docs.google.com/presentation/d/1V9SNfD9hwOIfe1zI-F5FDpwDs5kD378tsMAYzClupus
- **Drive — All brand assets:** https://drive.google.com/drive/folders/1zLpDguYGZaEJ2o_aMoqo5nuBnxIT03QO
- **Live site:** https://www.spottedzebra.co.uk · **2026 concept** (in `research/`).
- Brand assets (logos, the Spot, pattern, Visby CF fonts, photography) were provided directly by the user and live in `assets/`.

## Company context
Spotted Zebra is a UK-HQ B2B enterprise hiring platform. It unites **AI Interview**, **Interview Intelligence** and **Assessment** in one platform, underpinned by validated skills science (1M+ assessments) and governed AI (ISO 42001/27001, EU AI Act). It serves four audiences — **buyers/clients, professional end-users (HMs, recruiters), candidates, and employees** — with one coherent core brand that flexes in friendliness by audience. "Spot" is the in-product AI assistant.

---

## CONTENT FUNDAMENTALS — how Spotted Zebra writes

- **Voice:** Bold and energetic · essential and iconic · human. Confident and innovative, yet professional and trustworthy. Precision and clarity over cleverness.
- **Person:** Speaks to the reader as **"you"** ("the outcomes you need"); refers to itself as **"we"** / "Spotted Zebra". Candidate-facing copy is clear, helpful, fair.
- **Casing:** Sentence case for headlines and UI ("Make every conversation count"). UPPERCASE only for the small tracked **eyebrow** label and tiny badges (AI, NEW). Never ALL-CAPS sentences.
- **Headlines:** Short, declarative, benefit-led. Often a wordplay anchor ("Spot the right hire, every time"). One key idea per line.
- **Sentence length:** A "key bit of information" should never exceed one sentence. Body in short paragraphs — "too much and your content won't be read."
- **Numbers as proof:** Hard outcomes carry the argument — `25% faster time to hire`, `8x ROI`, `1M+ assessments`, `2x top-performer success rate`. Use real, specific figures; don't invent filler stats.
- **Tone by audience:** more friendly/playful internally and to candidates; more assured and evidence-led to buyers.
- **Spelling:** British English (organisation, optimise, programme, colour).
- **Emoji:** Not used in marketing or decks. (Some internal deck templates show emoji placeholders — replace these with the Spot or brand icons.)
- **Punctuation:** Curly quotes and a spaced en-dash "—" for asides. Avoid exclamation marks.
- **Examples:** "Spot the right hire, every time." · "Make every conversation count." · "One platform across the entire hiring journey." · "Hire for skills, not just experience."

---

## VISUAL FOUNDATIONS

- **Overall vibe:** Clean, white-led, generous whitespace, confident. "Less is more" — decorative elements support, never distract. The 2026 direction deliberately uses **less blue** than before: white is the canvas, blue is the accent.
- **Colour:** Blue `#006AFF` is the primary/hero — CTAs, links, small accent bars, and exactly **one bold blue band per page/section**. **Text on the blue surface is always white — never black/ink** (use `--text-on-blue`; buttons on blue use the white `inverse` variant). Yellow `#FFD129` is a sparing signal — the **thin underline** (`.sz-underline`, breaks around descenders) beneath a key phrase, the Spot, dots. Navy `#003886` exists for depth but is used **rarely and never as the only brand colour**. Black/ink for text and dark closing surfaces. A warm-neutral grey ramp handles text, hairline borders and the quiet grey-050 section bands.
- **Type:** **Visby CF** throughout (Light/Regular/Medium/Bold — **never italic**). Display is large, **bold and tight** (negative tracking); body is Regular at a comfortable 17px in warm grey. DM Sans is the documented fallback. See `tokens/typography.css`.
- **Layout:** Centred hero copy in a ~760px measure; 1200px max content width; sections on a generous ~96–128px vertical rhythm; alternating white / grey-050 bands. Sticky translucent (blurred) header.
- **Backgrounds:** Predominantly flat white or grey-050. **No gradients on type or as decoration.** The one rich moment is the solid blue CTA band, which may carry the striped Spot pattern at ~7–8% opacity as texture. Photography is used full-bleed in showcase panels.
- **Imagery:** Candid, warm, natural-light **workplace photography** — real people in conversation, mixed teams, soft depth of field. Not stocky/clinical, not cool/desaturated. Lives in rounded panels (radius-lg) with a soft even shadow; often paired with a floating Spot or UI chip.
- **The Spot:** The striped circle is the signature mechanic — blue/yellow/black/white only, four fixed angles, never outlined. Used as a focal accent, an icon stand-in, decoration bleeding off a corner, or (as a full pattern) a textured panel.
- **Corners & cards:** Restrained. Cards use a small **8px** radius, a **1px hairline border** (grey-200), white surface, and frequently a short **blue top tab**. Buttons and chips are full **pills**. Large panels and the blue band use a 20px radius. The Spot and avatars are circles.
- **Shadows:** Soft and **even** — the deck spec literally calls for *opacity 20, angle 0, distance 0, blur 20*: a diffuse glow with no harsh directional offset. Blue CTAs carry a soft blue-tinted lift.
- **Borders:** Hairline `1px` grey-200 for cards and dividers; grey-300 for stronger outlines (secondary buttons).
- **Motion:** Calm and quick. Short ease-out fades and small lifts (cards rise 2px on hover); ~120–360ms. **Never bouncy**, no infinite decorative loops.
- **Hover:** Primary button darkens (blue→blue-700); secondary fills to grey-100; cards lift + shadow; links underline. **Press:** a subtle 1px downward nudge (no shrink, no colour flip).
- **Transparency & blur:** Used sparingly — the translucent blurred header, the low-opacity Spot texture on blue, and white ring around stacked avatars.
- **Focus:** 3px solid blue ring, 2px offset — always visible for accessibility (WCAG 2.0 AA is a brand commitment).

---

## ICONOGRAPHY

- Spotted Zebra has **no proprietary marketing icon font.** The dominant brand "icon" is **the Spot** — used as a bullet, accent, or focal mark (see `assets/symbol`, components `Spot`).
- For functional UI icons in web/deck work, use a **CDN line-icon set with a clean, ~1.75px stroke and rounded joins — Lucide** (https://lucide.dev) — which sits well next to Visby CF's geometric forms. This is a **substitution** (the brand hasn't standardised a marketing icon set); flag it if exact parity matters. Keep icons monochrome (ink or blue), never multicolour.
- **Emoji are not used.** Some legacy internal deck templates contain emoji placeholders (🎯, 🎁) — replace these with the Spot or a Lucide icon.
- Logos, the Spot (SVG + 2× PNG) and the striped pattern are real assets in `assets/` — always use these files; never redraw them.

---

## INDEX

**Root**
- `styles.css` — single entry point (consumers link this). `@import`s only.
- `tokens/` — `fonts.css` (@font-face Visby CF + DM Sans), `colors.css`, `typography.css`, `spacing.css`, `effects.css`, `base.css`.
- `assets/` — `logo/` (6 colourway SVGs of the redesigned stacked wordmark), `symbol/` (the round Spot: blue/yellow/black/white PNG, plus `symbol-bg.png` pattern), `fonts/` (Visby CF OTF), `imagery/` (workplace photography).
- `guidelines/` — foundation specimen cards (Type, Colors, Spacing, Brand).
- `research/` — the 2026 website concept reference.
- `SKILL.md` — portable skill manifest.

**Components** (`components/<group>/`, React, exported on `window.DesignSystem_a3a922`)
- `actions/` — **Button** (primary · secondary · ghost · inverse; sm/md/lg)
- `brand/` — **Logo** (6 colourways) · **Spot** (striped circle)
- `content/` — **Card** (blue top tab, link) · **StatBlock** · **Quote** · **Table** (hairline data table)
- `display/` — **Eyebrow** · **Tag** · **Badge** · **Avatar**

**UI kit** — `ui_kits/website/`: `index.html` (homepage), `product.html` (AI Interview feature page), `kit.css`.

**Slides** — `slides/`: cover · agenda · section divider · two-column · text+image · key numbers · key quote · process · closing (`slides.css`).

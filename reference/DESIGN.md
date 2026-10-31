---
name: Autonomous Invoice Intelligence
colors:
  surface: '#141319'
  surface-dim: '#141319'
  surface-bright: '#3a383f'
  surface-container-lowest: '#0e0d13'
  surface-container-low: '#1c1b21'
  surface-container: '#201f25'
  surface-container-high: '#2b2930'
  surface-container-highest: '#35343b'
  on-surface: '#e5e1ea'
  on-surface-variant: '#e0c0b1'
  inverse-surface: '#e5e1ea'
  inverse-on-surface: '#312f36'
  outline: '#a78b7d'
  outline-variant: '#584237'
  surface-tint: '#ffb690'
  primary: '#ffb690'
  on-primary: '#552100'
  primary-container: '#f97316'
  on-primary-container: '#582200'
  inverse-primary: '#9d4300'
  secondary: '#ffb95f'
  on-secondary: '#472a00'
  secondary-container: '#ee9800'
  on-secondary-container: '#5b3800'
  tertiary: '#4edea3'
  on-tertiary: '#003824'
  tertiary-container: '#00b07a'
  on-tertiary-container: '#003b26'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#ffdbca'
  primary-fixed-dim: '#ffb690'
  on-primary-fixed: '#341100'
  on-primary-fixed-variant: '#783200'
  secondary-fixed: '#ffddb8'
  secondary-fixed-dim: '#ffb95f'
  on-secondary-fixed: '#2a1700'
  on-secondary-fixed-variant: '#653e00'
  tertiary-fixed: '#6ffbbe'
  tertiary-fixed-dim: '#4edea3'
  on-tertiary-fixed: '#002113'
  on-tertiary-fixed-variant: '#005236'
  background: '#141319'
  on-background: '#e5e1ea'
  surface-variant: '#35343b'
typography:
  display-xl:
    fontFamily: Geist
    fontSize: 56px
    fontWeight: '600'
    lineHeight: 64px
    letterSpacing: -0.03em
  display-xl-mobile:
    fontFamily: Geist
    fontSize: 36px
    fontWeight: '600'
    lineHeight: 44px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Geist
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.025em
  headline-lg-mobile:
    fontFamily: Geist
    fontSize: 26px
    fontWeight: '600'
    lineHeight: 34px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Geist
    fontSize: 24px
    fontWeight: '500'
    lineHeight: 32px
    letterSpacing: -0.02em
  title-sm:
    fontFamily: Geist
    fontSize: 18px
    fontWeight: '500'
    lineHeight: 26px
    letterSpacing: -0.015em
  body-lg:
    fontFamily: Geist
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: -0.01em
  body-md:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: -0.005em
  body-sm:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0em
  label-code:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: -0.01em
  label-numeric:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '600'
    lineHeight: 18px
    letterSpacing: -0.02em
  badge-caps:
    fontFamily: Geist
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.06em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1.5rem
  gutter-sm: 1rem
  gutter-lg: 2rem
  margin: 2rem
  margin-mobile: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

## Brand & Style

This design system embodies high-precision fintech intelligence, tailored for automated invoice extraction, audit automation, and financial parsing. The visual language blends rigorous architectural structure with luminous modern craft, communicating immediate machine reliability, legal-grade compliance, and sovereign data clarity.

The core design style unifies **Precision Minimalism** with **Atmospheric Glassmorphism**:
- **Structured Precision**: Every alignment is mathematically grounded. Borders are hairline-thin and razor-sharp, communicating analytical certainty rather than playful softness.
- **Atmospheric Luminance**: Surface tiers utilize soft light diffusion, subtle directional rim highlights, and controlled backdrop blurs.
- **Sovereign Contrast**: Content surfaces are neutral, serene, and uncluttered, leaving high-energy amber and kinetic orange strictly for critical telemetry, processing pipelines, interactive primary paths, and confidence scoring.
- **Emotional Stance**: The interface evokes calmness under volume, surgical financial clarity, and institutional-grade prestige.

## Colors

The system operates across dual atmospheric states, calibrated for analytical density and minimal ocular fatigue during prolonged financial auditing sessions.

### Dark Theme (Default)
- **Canvas Base**: `#0B0A10` (deep purplish-black cosmic baseline).
- **Surface Elevation 1 (Card/Container)**: `rgba(18, 15, 29, 0.72)` with a 12px blur backdrop.
- **Surface Elevation 2 (Popovers/Overlays)**: `rgba(23, 19, 38, 0.88)` with internal light bleed.
- **Interactive Primary**: `#F97316` (electric solar orange) grading to `#EA580C`.
- **Interactive Secondary / Glow Accent**: `#FB923C` and `#F59E0B` (luminous amber).
- **Hairline Borders**: `rgba(255, 255, 255, 0.08)` baseline, scaling to `rgba(249, 115, 22, 0.35)` on active parsing boundaries.
- **Text & Data**: Primary: `#F9FAFB`; Muted/Meta: `#9CA3AF`; Code/Key: `#C4B5FD`.

### Light Theme
- **Canvas Base**: `#F4F6F9` stepping into `#F8FAFC`.
- **Surface Elevation 1**: `#FFFFFF` with ultra-soft ice-white diffuse perimeter glow (`rgba(255, 255, 255, 0.95)` atop subtle neutral drop-shadows).
- **Interactive Primary**: `#EA580C` grading down to `#D97706` for strong, contrast-compliant accessibility on white surfaces.
- **Accent Highlight**: `#F59E0B` (amber gold) used for confidence alerts and pending parsing queues.
- **Hairline Borders**: `rgba(15, 23, 42, 0.08)` default; focus state: `rgba(234, 88, 12, 0.40)`.
- **Text & Data**: Primary: `#0F172A`; Muted/Meta: `#64748B`.

### Semantic Tokens (Functional Statuses)
- **Extraction Verified / Confidence ≥ 98%**: Emerald `#10B981`.
- **Extraction Warning / Confidence 70–97%**: Amber `#F59E0B`.
- **Extraction Failed / Field Missing**: Crimson `#EF4444`.
- **Processing Stream**: Radiant Violet `#8B5CF6`.

## Typography

The typographic hierarchy is calibrated for scan speed, tabular alignment, and zero ambiguity between alphanumeric values.

- **Primary Interface Font**: `Geist` balances geometric neutrality with high screen fidelity. Headings use negative letter-spacing for high-density elegance.
- **Technical & Tabular Engine**: `JetBrains Mono` handles all invoice totals, VAT identifiers, confidence thresholds, and raw JSON payloads. Its monospaced rhythm ensures that decimal points and financial figures align continuously down tabular structures.
- **Hierarchy Rules**:
  - Never allow raw uppercase text outside of `badge-caps` or ISO country/currency codes.
  - Numbers in data tables must always enforce tabular figures (`font-variant-numeric: tabular-nums`).
  - Invoice balance headers combine `Geist` labels with `JetBrains Mono` values for instantaneous visual separation of attribute and value.

## Layout & Spacing

The layout is built upon an 8-point base spatial rhythm designed for multi-column document extraction workflows, side-by-side verification consoles, and tabular reporting dashboards.

### Grid Framework
- **Desktop (1440px+)**: 12-column adaptive grid with a `2rem` margin and `1.5rem` gutters. The primary view uses an asymmetrical split: a 5-column sticky document renderer (PDF/TIFF/Image) alongside a 7-column real-time telemetry and extraction field panel.
- **Tablet (768px - 1439px)**: 8-column layout with `1.5rem` margins and `1rem` gutters. Verification workspaces switch to a tabbed dual-pane inspector.
- **Mobile (Below 768px)**: 4-column fluid layout with `1rem` margin and `0.75rem` gutter. Data tables switch to stacked transaction cards.

### Spacing Hygiene
- Form fields and parsed attribute keys use `space-xs` (4px) internal labels and `space-md` (16px) vertical stack gaps.
- Data density tiers are preserved: dense inspection views collapse padding to `space-sm` (8px), whereas macro dashboards expand section dividers to `space-xl` (40px).

## Elevation & Depth

Visual depth is achieved through translucent planar layering, directional rim luminescence, and backdrop blur filtration, rather than heavy drop shadows.

### Glass Tier System
- **Tier 0 (Substrate)**: Base canvas tint (`#0B0A10` Dark / `#F4F6F9` Light) with an ultra-faint, non-distracting dot matrix or fine grain texture.
- **Tier 1 (Surface Panel)**:
  - Dark: `rgba(18, 15, 29, 0.65)` fill, `backdrop-filter: blur(16px)`, border: `1px solid rgba(255, 255, 255, 0.07)`.
  - Light: `rgba(255, 255, 255, 0.85)` fill, `backdrop-filter: blur(12px)`, border: `1px solid rgba(15, 23, 42, 0.06)`, shadow: `0 4px 20px -2px rgba(15, 23, 42, 0.05)`.
- **Tier 2 (Elevated Interactive / Hover)**:
  - Dark: `rgba(23, 19, 38, 0.80)` fill, border: `1px solid rgba(249, 115, 22, 0.25)`, subtle outward glow: `0 0 24px -4px rgba(249, 115, 22, 0.12)`.
  - Light: `rgba(255, 255, 255, 1.0)`, border: `1px solid rgba(234, 88, 12, 0.30)`, shadow: `0 8px 30px -4px rgba(234, 88, 12, 0.08)`.
- **Tier 3 (Floating Popovers / Raw Extraction Modal)**:
  - Fill: `rgba(11, 10, 16, 0.94)` (Dark) / `rgba(255, 255, 255, 0.98)` (Light), with edge highlight inset: `inset 0 1px 0 0 rgba(255, 255, 255, 0.15)`.

### Lighting & Rim Light
Every elevated card features a 1px top edge gradient (`linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent)`) simulating an overhead directional light source hitting beveled precision glass.

## Shapes

The shape geometry utilizes a **Soft (Level 1)** structure, anchoring the system in crisp industrial clarity.

- **Micro Controls & Chips**: `0.25rem` (4px) corner radius. This gives badges and data pill tags a sharp, technical presence instead of playful rounded forms.
- **Input Fields & Buttons**: `0.375rem` (6px) corner radius. Balanced tactile feedback with strict orthogonal alignment.
- **Cards & Data Viewers**: `0.5rem` (8px) (`rounded-lg`). Creates a cohesive container footprint that preserves spatial efficiency on dense multi-column invoice tables.
- **Modals & Flyout Sheets**: `0.75rem` (12px) (`rounded-xl`).
- **Interactive Focus Rings**: Crisp 2px offset border with zero radius distortion.

## Components

### Buttons
- **Primary Action (e.g., "Confirm Extraction", "Reprocess Invoice")**:
  - Background: Gradient `linear-gradient(135deg, #F97316 0%, #EA580C 100%)`.
  - Color: `#FFFFFF`; Font: `Geist` SemiBold.
  - Border: `1px solid rgba(255, 255, 255, 0.20)` top highlight, `inset 0 1px 0 rgba(255, 255, 255, 0.25)`.
  - Shadow: `0 4px 14px rgba(234, 88, 12, 0.35)`.
  - Hover: Subtle brightness lift + `0 6px 20px rgba(249, 115, 22, 0.45)`.
- **Secondary / Ghost**: Translucent glass background with hairline `rgba(255, 255, 255, 0.10)` border, transitioning to amber border on focus.

### Inputs & Field Matchers
- Single extraction cells contain the localized bounding box coordinate, original OCR string, and parsed value.
- Background: Translucent dark `rgba(0, 0, 0, 0.25)` or pristine light `#FFFFFF`.
- Validation States: Unverified values display an amber dashed underline; fully reconciled values feature a micro emerald tick.

### Chips & Confidence Badges
- Constructed with `JetBrains Mono` and `badge-caps`.
- Format: `[CONF: 99.4%]` | `[TAX_ID: VALID]`.
- Background: 10% tint of the semantic color with a 20% opacity matching border.

### Telemetry Cards & Metric Panels
- Compact metric blocks presenting throughput velocity (e.g., "124 docs/min"), OCR confidence aggregate, and pending batch latency.
- Internal borders use hairline frosted glass lines. Top corners carry a 2px micro-accent light bleed.

### JSON Syntax Viewer & Schema Tree
- Monospaced editor module with deep contrast dark substrate (`#08070D`).
- Syntax highlighting tokens: Keys `#C4B5FD` (light lavender), String values `#FED7AA` (soft apricot), Numbers/Booleans `#F97316` (amber orange), Punctuation `rgba(255, 255, 255, 0.3)`.
- Features an instant "Copy Schema", "Diff Original", and line-by-line field selection synced with the document canvas.

### Document Viewer Overlay
- Precision canvas equipped with dynamic SVG bounding boxes colored in translucent electric amber (`rgba(249, 115, 22, 0.15)`) with animated perimeter pulse during active extraction.
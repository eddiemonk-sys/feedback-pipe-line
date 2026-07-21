/* @ds-bundle: {"format":4,"namespace":"DesignSystem_a3a922","components":[{"name":"Button","sourcePath":"components/actions/Button.jsx"},{"name":"Logo","sourcePath":"components/brand/Logo.jsx"},{"name":"Spot","sourcePath":"components/brand/Spot.jsx"},{"name":"Card","sourcePath":"components/content/Card.jsx"},{"name":"Quote","sourcePath":"components/content/Quote.jsx"},{"name":"StatBlock","sourcePath":"components/content/StatBlock.jsx"},{"name":"Table","sourcePath":"components/content/Table.jsx"},{"name":"Avatar","sourcePath":"components/display/Avatar.jsx"},{"name":"Badge","sourcePath":"components/display/Badge.jsx"},{"name":"Eyebrow","sourcePath":"components/display/Eyebrow.jsx"},{"name":"Tag","sourcePath":"components/display/Tag.jsx"}],"sourceHashes":{"components/actions/Button.jsx":"d5ad37b85ce8","components/brand/Logo.jsx":"70623d0c7f7c","components/brand/Spot.jsx":"ae1f0d25efaf","components/content/Card.jsx":"496ab765755e","components/content/Quote.jsx":"293faddbfeeb","components/content/StatBlock.jsx":"c4dcac7ec13c","components/content/Table.jsx":"b011e547c8c7","components/display/Avatar.jsx":"179813a35888","components/display/Badge.jsx":"638e14fce62f","components/display/Eyebrow.jsx":"f4424feb0038","components/display/Tag.jsx":"4026eeef3579","website/_components/site.js":"318ec1eb780f","website/discovery/_canvas/canvas.js":"5cfc2f895d19"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.DesignSystem_a3a922 = window.DesignSystem_a3a922 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/actions/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Injects the component stylesheet once per document. */
function useStyleOnce(id, css) {
  if (typeof document === "undefined") return;
  if (document.getElementById(id)) return;
  const el = document.createElement("style");
  el.id = id;
  el.textContent = css;
  document.head.appendChild(el);
}
const CSS = `
.sz-btn{
  --_bg:var(--sz-blue); --_fg:#fff; --_bd:transparent;
  display:inline-flex; align-items:center; justify-content:center; gap:.5em;
  font-family:var(--font-display); font-weight:var(--fw-bold);
  font-size:var(--fs-body); line-height:1; letter-spacing:var(--ls-heading);
  padding:0 1.5em; height:3em; border-radius:var(--radius-pill);
  background:var(--_bg); color:var(--_fg); border:1.5px solid var(--_bd);
  cursor:pointer; text-decoration:none; white-space:nowrap;
  transition:transform var(--dur-fast) var(--ease-out), background var(--dur) var(--ease-out), box-shadow var(--dur) var(--ease-out);
}
.sz-btn:hover{ text-decoration:none; }
.sz-btn:active{ transform:translateY(1px); }
.sz-btn:focus-visible{ outline:var(--focus-ring-width) solid var(--focus-ring); outline-offset:var(--focus-ring-offset); }
.sz-btn[disabled]{ opacity:.45; cursor:not-allowed; pointer-events:none; }

.sz-btn--primary{ --_bg:var(--sz-blue); --_fg:#fff; box-shadow:var(--shadow-blue); }
.sz-btn--primary:hover{ --_bg:var(--sz-blue-700); }

.sz-btn--secondary{ --_bg:transparent; --_fg:var(--sz-ink); --_bd:var(--border-strong); }
.sz-btn--secondary:hover{ --_bg:var(--sz-grey-100); }

.sz-btn--ghost{ --_bg:transparent; --_fg:var(--sz-blue); --_bd:transparent; padding-inline:.6em; }
.sz-btn--ghost:hover{ --_bg:var(--sz-blue-050); }

.sz-btn--inverse{ --_bg:#fff; --_fg:var(--sz-blue); --_bd:transparent; }
.sz-btn--inverse:hover{ --_bg:var(--sz-grey-100); }

.sz-btn--sm{ font-size:var(--fs-body-s); height:2.5em; padding-inline:1.15em; }
.sz-btn--lg{ font-size:var(--fs-lead); height:3.3em; padding-inline:1.8em; }
`;

/**
 * Spotted Zebra primary action. Pill-shaped, Visby CF Bold.
 * Blue is the hero (primary); secondary is a hairline-outlined white pill;
 * inverse is for use on the blue CTA band.
 */
function Button({
  variant = "primary",
  size = "md",
  as = "button",
  children,
  className = "",
  ...props
}) {
  useStyleOnce("sz-btn-css", CSS);
  const Tag = as;
  const cls = ["sz-btn", `sz-btn--${variant}`, size !== "md" ? `sz-btn--${size}` : "", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement(Tag, _extends({
    className: cls
  }, props), children);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/actions/Button.jsx", error: String((e && e.message) || e) }); }

// components/brand/Logo.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const FILE = {
  "black-blue": "sz-blackblue.png",
  "black-yellow": "sz-blackyellow.png",
  "black": "sz-black.png",
  "white-blue": "sz-whiteblue.png",
  "white-yellow": "sz-whiteyellow.png",
  "white": "sz-white.png"
};

/**
 * Spotted Zebra wordmark. Renders the official logo SVG in one of the six
 * approved colourways. Point `basePath` at where you copied /assets/logo.
 */
function Logo({
  colorway = "black-blue",
  height = 32,
  basePath = "assets/logo",
  className = "",
  style,
  ...props
}) {
  const file = FILE[colorway] || FILE["black-blue"];
  const h = typeof height === "string" && /^\d+(\.\d+)?$/.test(height) ? Number(height) : height;
  return /*#__PURE__*/React.createElement("img", _extends({
    src: `${basePath}/${file}`,
    alt: "Spotted Zebra",
    className: className,
    style: {
      height: h,
      width: "auto",
      display: "block",
      ...style
    }
  }, props));
}
Object.assign(__ds_scope, { Logo });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/brand/Logo.jsx", error: String((e && e.message) || e) }); }

// components/brand/Spot.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const FILE = {
  "blue": "symbol-blue1.png",
  "yellow": "symbolyellow-1.png",
  "black": "symbolblack-1.png",
  "white": "symbolwhite-1.png"
};

/**
 * The Spot — Spotted Zebra's signature round striped circle. A focal/decorative
 * mechanic; use sparingly. Point `basePath` at the copied /assets/symbol folder.
 */
function Spot({
  color = "blue",
  size = 64,
  basePath = "assets/symbol",
  className = "",
  style,
  ...props
}) {
  const file = FILE[color] || FILE.blue;
  const s = typeof size === "string" && /^\d+(\.\d+)?$/.test(size) ? Number(size) : size;
  return /*#__PURE__*/React.createElement("img", _extends({
    src: `${basePath}/${file}`,
    alt: "",
    "aria-hidden": "true",
    className: className,
    style: {
      width: s,
      height: s,
      display: "block",
      ...style
    }
  }, props));
}
Object.assign(__ds_scope, { Spot });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/brand/Spot.jsx", error: String((e && e.message) || e) }); }

// components/content/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function useStyleOnce(id, css) {
  if (typeof document === "undefined") return;
  if (document.getElementById(id)) return;
  const el = document.createElement("style");
  el.id = id;
  el.textContent = css;
  document.head.appendChild(el);
}
const CSS = `
.sz-card{
  position:relative; display:flex; flex-direction:column;
  background:var(--surface-card); border:1px solid var(--border-hairline);
  border-radius:var(--radius-sm); padding:var(--space-6);
  transition:box-shadow var(--dur) var(--ease-out), transform var(--dur) var(--ease-out), border-color var(--dur) var(--ease-out);
}
.sz-card--tab{ padding-top:calc(var(--space-6) + 6px); }
.sz-card--tab::before{
  content:""; position:absolute; top:0; left:var(--space-6);
  width:34px; height:4px; border-radius:0 0 3px 3px; background:var(--sz-blue);
}
.sz-card--interactive{ cursor:pointer; }
.sz-card--interactive:hover{ box-shadow:var(--shadow-md); transform:translateY(-2px); border-color:transparent; }
.sz-card__title{ font-family:var(--font-display); font-weight:var(--fw-bold); font-size:var(--fs-h3); color:var(--text-strong); margin:0 0 var(--space-3); letter-spacing:var(--ls-heading); }
.sz-card__body{ font-size:var(--fs-body-s); color:var(--text-body); margin:0; line-height:var(--lh-normal); }
.sz-card__foot{ margin-top:var(--space-5); }
.sz-card__link{ font-family:var(--font-display); font-weight:var(--fw-bold); font-size:var(--fs-body-s); color:var(--sz-blue); text-decoration:none; }
.sz-card--interactive:hover .sz-card__link{ text-decoration:underline; }
`;

/** Content card — white surface, hairline border, optional blue top tab and link. */
function Card({
  title,
  children,
  tab = false,
  interactive = false,
  link,
  href = "#",
  className = "",
  ...props
}) {
  useStyleOnce("sz-card-css", CSS);
  const cls = ["sz-card", tab ? "sz-card--tab" : "", interactive ? "sz-card--interactive" : "", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("div", _extends({
    className: cls
  }, props), title && /*#__PURE__*/React.createElement("h3", {
    className: "sz-card__title"
  }, title), children && /*#__PURE__*/React.createElement("div", {
    className: "sz-card__body"
  }, children), link && /*#__PURE__*/React.createElement("div", {
    className: "sz-card__foot"
  }, /*#__PURE__*/React.createElement("a", {
    className: "sz-card__link",
    href: href
  }, link, " \u2192")));
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/content/Card.jsx", error: String((e && e.message) || e) }); }

// components/content/Quote.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Testimonial / pull-quote. Large Visby quote with attribution; optional avatar.
 * Keep quotes to 2–3 sentences (brand rule).
 */
function Quote({
  children,
  name,
  role,
  avatar,
  size = "lg",
  className = "",
  style,
  ...props
}) {
  const quoteSize = size === "lg" ? "var(--fs-h2)" : "var(--fs-lead)";
  return /*#__PURE__*/React.createElement("figure", _extends({
    className: className,
    style: {
      margin: 0,
      ...style
    }
  }, props), /*#__PURE__*/React.createElement("blockquote", {
    style: {
      margin: 0,
      fontFamily: "var(--font-display)",
      fontWeight: "var(--fw-medium)",
      fontSize: quoteSize,
      lineHeight: "var(--lh-snug)",
      letterSpacing: "var(--ls-heading)",
      color: "var(--text-strong)"
    }
  }, typeof children === "string" ? `\u201C${children}\u201D` : children), (name || role) && /*#__PURE__*/React.createElement("figcaption", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "var(--space-3)",
      marginTop: "var(--space-5)"
    }
  }, avatar && /*#__PURE__*/React.createElement("img", {
    src: avatar,
    alt: name || "",
    style: {
      width: 44,
      height: 44,
      borderRadius: "50%",
      objectFit: "cover",
      flex: "none"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "var(--fs-body-s)",
      color: "var(--text-body)"
    }
  }, name && /*#__PURE__*/React.createElement("strong", {
    style: {
      color: "var(--text-strong)",
      fontWeight: "var(--fw-bold)"
    }
  }, name), name && role && " · ", role)));
}
Object.assign(__ds_scope, { Quote });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/content/Quote.jsx", error: String((e && e.message) || e) }); }

// components/content/StatBlock.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * A single headline statistic — big bold Visby number with a small label.
 * Used in the stats band on web and on metric slides.
 */
function StatBlock({
  value,
  label,
  align = "center",
  className = "",
  style,
  ...props
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    className: className,
    style: {
      textAlign: align,
      ...style
    }
  }, props), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "var(--font-display)",
      fontWeight: "var(--fw-bold)",
      fontSize: "var(--fs-display-m)",
      lineHeight: 1,
      letterSpacing: "var(--ls-display)",
      color: "var(--text-strong)"
    }
  }, value), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "var(--space-3)",
      fontSize: "var(--fs-body-s)",
      color: "var(--text-muted)",
      maxWidth: "18ch",
      marginInline: align === "center" ? "auto" : undefined
    }
  }, label));
}
Object.assign(__ds_scope, { StatBlock });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/content/StatBlock.jsx", error: String((e && e.message) || e) }); }

// components/content/Table.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function useStyleOnce(id, css) {
  if (typeof document === "undefined") return;
  if (document.getElementById(id)) return;
  const el = document.createElement("style");
  el.id = id;
  el.textContent = css;
  document.head.appendChild(el);
}
const CSS = `
.sz-table-wrap{ width:100%; overflow-x:auto; }
.sz-table{ width:100%; border-collapse:collapse; font-family:var(--font-body); }
.sz-table caption{
  caption-side:top; text-align:left; font-family:var(--font-display);
  font-weight:var(--fw-bold); font-size:var(--fs-h3); color:var(--text-strong);
  letter-spacing:var(--ls-heading); margin-bottom:var(--space-4);
}
.sz-table th{
  text-align:left; font-family:var(--font-display); font-weight:var(--fw-bold);
  font-size:var(--fs-body-s); color:var(--text-strong); background:var(--surface-band);
  border-bottom:2px solid var(--sz-blue); padding:var(--space-3) var(--space-4);
  white-space:nowrap; vertical-align:bottom;
}
.sz-table td{
  font-size:var(--fs-body-s); color:var(--text-body);
  border-bottom:1px solid var(--border-hairline);
  padding:var(--space-3) var(--space-4); vertical-align:top; line-height:var(--lh-normal);
}
.sz-table tbody tr:last-child td{ border-bottom:none; }
.sz-table--striped tbody tr:nth-child(even) td{ background:var(--sz-grey-050); }
.sz-table--hover tbody tr{ transition:background var(--dur-fast) var(--ease-out); }
.sz-table--hover tbody tr:hover td{ background:var(--sz-blue-050); }
.sz-table--compact th,.sz-table--compact td{ padding:var(--space-2) var(--space-3); }
.sz-table th.sz-table__num,.sz-table td.sz-table__num{ text-align:right; font-variant-numeric:tabular-nums; }
.sz-table th.sz-table__center,.sz-table td.sz-table__center{ text-align:center; }
.sz-table tr.sz-row--success td{ color:var(--status-success); }
.sz-table tr.sz-row--muted td{ color:var(--text-muted); }
.sz-table tr.sz-row--accent td{ background:var(--sz-blue-050); }
.sz-table__cell--strong{ font-family:var(--font-display); font-weight:var(--fw-bold); color:var(--text-strong); }
`;
function alignClass(align) {
  if (align === "right") return "sz-table__num";
  if (align === "center") return "sz-table__center";
  return "";
}

/**
 * Data table — white surface, hairline rows, grey-050 header with a blue
 * underline. Drive it with `columns` + `rows`, or pass raw <thead>/<tbody>
 * as children.
 */
function Table({
  columns,
  rows,
  caption,
  striped = false,
  hover = true,
  compact = false,
  className = "",
  children,
  ...props
}) {
  useStyleOnce("sz-table-css", CSS);
  const cls = ["sz-table", striped ? "sz-table--striped" : "", hover ? "sz-table--hover" : "", compact ? "sz-table--compact" : "", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("div", {
    className: "sz-table-wrap"
  }, /*#__PURE__*/React.createElement("table", _extends({
    className: cls
  }, props), caption && /*#__PURE__*/React.createElement("caption", null, caption), columns && /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, columns.map((c, i) => /*#__PURE__*/React.createElement("th", {
    key: c.key ?? i,
    className: alignClass(c.align),
    style: c.width ? {
      width: c.width
    } : undefined,
    scope: "col"
  }, c.label)))), rows && /*#__PURE__*/React.createElement("tbody", null, rows.map((r, ri) => {
    const tone = r._tone;
    return /*#__PURE__*/React.createElement("tr", {
      key: r._key ?? ri,
      className: tone ? `sz-row--${tone}` : ""
    }, columns.map((c, ci) => {
      const strong = ci === 0 && !c.plain;
      return /*#__PURE__*/React.createElement("td", {
        key: c.key ?? ci,
        className: [alignClass(c.align), strong ? "sz-table__cell--strong" : ""].filter(Boolean).join(" ")
      }, r[c.key]);
    }));
  })), children));
}
Object.assign(__ds_scope, { Table });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/content/Table.jsx", error: String((e && e.message) || e) }); }

// components/display/Avatar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Round avatar. Pass a photo `src`, or render initials as a fallback. */
function Avatar({
  src,
  name = "",
  size = 44,
  ring = false,
  className = "",
  style,
  ...props
}) {
  const initials = name.split(" ").map(p => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  const base = {
    width: size,
    height: size,
    borderRadius: "50%",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flex: "none",
    overflow: "hidden",
    background: "var(--sz-blue-050)",
    color: "var(--sz-blue-700)",
    fontFamily: "var(--font-display)",
    fontWeight: "var(--fw-bold)",
    fontSize: size * 0.38,
    boxShadow: ring ? "0 0 0 3px #fff, 0 0 0 4px var(--border-hairline)" : "none",
    ...style
  };
  return /*#__PURE__*/React.createElement("span", _extends({
    className: className,
    style: base
  }, props), src ? /*#__PURE__*/React.createElement("img", {
    src: src,
    alt: name,
    style: {
      width: "100%",
      height: "100%",
      objectFit: "cover"
    }
  }) : initials || "·");
}
Object.assign(__ds_scope, { Avatar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Avatar.jsx", error: String((e && e.message) || e) }); }

// components/display/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function useStyleOnce(id, css) {
  if (typeof document === "undefined") return;
  if (document.getElementById(id)) return;
  const el = document.createElement("style");
  el.id = id;
  el.textContent = css;
  document.head.appendChild(el);
}
const CSS = `
.sz-badge{
  display:inline-flex; align-items:center; gap:.4em;
  font-family:var(--font-display); font-weight:var(--fw-bold);
  font-size:var(--fs-eyebrow); letter-spacing:.04em; text-transform:uppercase;
  line-height:1; padding:.45em .7em; border-radius:var(--radius-xs);
  background:var(--sz-ink); color:#fff;
}
.sz-badge--blue{ background:var(--sz-blue); color:#fff; }
.sz-badge--yellow{ background:var(--sz-yellow); color:var(--sz-ink); }
.sz-badge--soft{ background:var(--sz-blue-050); color:var(--sz-blue-700); }
`;

/** Compact emphatic label — e.g. an "AI" or "NEW" flag on a card or slide. */
function Badge({
  tone = "ink",
  children,
  className = "",
  ...props
}) {
  useStyleOnce("sz-badge-css", CSS);
  const cls = ["sz-badge", tone !== "ink" ? `sz-badge--${tone}` : "", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("span", _extends({
    className: cls
  }, props), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Badge.jsx", error: String((e && e.message) || e) }); }

// components/display/Eyebrow.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Small uppercase, letter-spaced label that sits above a heading.
 * A recurring Spotted Zebra device for section intros.
 */
function Eyebrow({
  as = "div",
  children,
  className = "",
  style,
  ...props
}) {
  const Tag = as;
  return /*#__PURE__*/React.createElement(Tag, _extends({
    className: className,
    style: {
      fontFamily: "var(--font-display)",
      fontSize: "var(--fs-eyebrow)",
      fontWeight: "var(--fw-bold)",
      letterSpacing: "var(--ls-eyebrow)",
      textTransform: "uppercase",
      color: "var(--text-muted)",
      ...style
    }
  }, props), children);
}
Object.assign(__ds_scope, { Eyebrow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Eyebrow.jsx", error: String((e && e.message) || e) }); }

// components/display/Tag.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function useStyleOnce(id, css) {
  if (typeof document === "undefined") return;
  if (document.getElementById(id)) return;
  const el = document.createElement("style");
  el.id = id;
  el.textContent = css;
  document.head.appendChild(el);
}
const CSS = `
.sz-tag{
  display:inline-flex; align-items:center; gap:.4em;
  font-family:var(--font-display); font-weight:var(--fw-medium);
  font-size:var(--fs-caption); line-height:1; letter-spacing:0;
  padding:.5em .85em; border-radius:var(--radius-pill);
  background:var(--sz-grey-100); color:var(--sz-grey-700); border:1px solid transparent;
}
.sz-tag--blue{ background:var(--sz-blue-050); color:var(--sz-blue-700); }
.sz-tag--yellow{ background:var(--sz-yellow-050); color:#7a5e00; }
.sz-tag--outline{ background:transparent; color:var(--sz-grey-700); border-color:var(--border-strong); }
.sz-tag__dot{ width:.5em; height:.5em; border-radius:50%; background:currentColor; }
`;

/** Small pill chip for categories, filters and metadata. */
function Tag({
  tone = "neutral",
  dot = false,
  children,
  className = "",
  ...props
}) {
  useStyleOnce("sz-tag-css", CSS);
  const cls = ["sz-tag", tone !== "neutral" ? `sz-tag--${tone}` : "", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("span", _extends({
    className: cls
  }, props), dot && /*#__PURE__*/React.createElement("span", {
    className: "sz-tag__dot"
  }), children);
}
Object.assign(__ds_scope, { Tag });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Tag.jsx", error: String((e && e.message) || e) }); }

// website/_components/site.js
try { (() => {
/* Spotted Zebra — shared site chrome as web components.
   ONE source of truth for the nav, footer, and closing CTA band, used by every
   page in both discovery/ and final/. Never copy this into a page folder.

   Load (path is relative to the page):
     from a discovery page  website/discovery/<page>/  →  ../../_components/site.js
     from a final page      website/final/             →  ../_components/site.js

   Usage:
     <sz-nav active="assessment"></sz-nav>
     <sz-nav active="platform" theme="blue"></sz-nav>
     <sz-cta heading="…" text="…" button="Book a demo" href="#"></sz-cta>
     <sz-footer></sz-footer>

   Paths + routing are derived from this script's URL and the page's location, so
   the same file works at any depth AND links correctly from both discovery and
   final (a nav on a final page links to sibling final pages; on a discovery page
   it links to the working drafts). */
(function () {
  // Resolve roots from THIS script's own URL: …/website/_components/site.js
  var here = document.currentScript && document.currentScript.src;
  if (!here) {
    var ss = document.querySelectorAll('script[src$="site.js"]');
    here = ss.length ? ss[ss.length - 1].src : location.href;
  }
  var WEBSITE = here.replace(/\/_components\/site\.js(\?.*)?$/, ""); // …/website
  var ASSETS = WEBSITE + "/../assets"; // project-root/assets
  var DISC = WEBSITE + "/discovery";
  var FINAL = WEBSITE + "/final";

  // Is the current page a live (final) page? Then route to sibling final pages.
  var ON_FINAL = /\/final\//.test(location.pathname);
  var LIVE = "https://www.spottedzebra.co.uk";

  // Pages we own (rebuilt in this DS). page → its discovery draft + final slug.
  // Anything with `page` routes internally (context-aware); `url` links to the live site.
  var PAGES = {
    home: {
      folder: "home",
      file: "home-v1.html",
      finalName: "home"
    },
    product: {
      folder: "product",
      file: "product-v1.html",
      finalName: "product"
    },
    assessment: {
      folder: "assessment",
      file: "assessment-v1-new.html",
      finalName: "assessment"
    },
    "platform-skills-science": {
      folder: "platform-skills-science",
      file: "platform-skills-science-v1.html",
      finalName: "platform-skills-science"
    },
    blog: {
      folder: "blog",
      file: "blog-v1.html",
      finalName: "blog"
    },
    "decision-making": {
      folder: "decision-making",
      file: "decision-making-v1.html",
      finalName: "decision-making"
    },
    "skills-leaders-network": {
      folder: "skills-leaders-network",
      file: "skills-leaders-network-v1.html",
      finalName: "skills-leaders-network"
    }
  };
  function pageHref(key) {
    var p = PAGES[key];
    return ON_FINAL ? FINAL + "/" + p.finalName + ".html" : DISC + "/" + p.folder + "/" + p.file;
  }
  function itemHref(it) {
    return it.page ? pageHref(it.page) : it.url || "#";
  }
  var HOME = pageHref("home");

  // Top-level IA — mirrors spottedzebra.co.uk. Owned pages use `page`; the rest link live.
  var NAV = [{
    key: "product",
    label: "Product",
    groups: [{
      items: [{
        label: "Product Overview",
        url: LIVE + "/product-overview"
      }]
    }, {
      heading: "Modules",
      items: [{
        label: "AI Interview",
        page: "product"
      }, {
        label: "Interview Intelligence",
        url: LIVE + "/interview-intelligence"
      }, {
        label: "Assessment",
        page: "assessment"
      }]
    }, {
      heading: "Capabilities",
      items: [{
        label: "Role Kick Off",
        url: LIVE + "/capabilities/role-kick-off"
      }, {
        label: "Interviewing",
        url: LIVE + "/capabilities/interviewing"
      }, {
        label: "Skills Assessment",
        url: LIVE + "/capabilities/skills-assessment"
      }, {
        label: "Decision-Making",
        page: "decision-making"
      }, {
        label: "Candidate Experience",
        url: LIVE + "/capabilities/candidate-experience"
      }]
    }]
  }, {
    key: "platform",
    label: "Platform",
    items: [{
      label: "Skills Science",
      page: "platform-skills-science"
    }, {
      label: "AI",
      url: LIVE + "/ai"
    }, {
      label: "Integrations",
      url: LIVE + "/integrations"
    }, {
      label: "Security and Compliance",
      url: LIVE + "/security-and-compliance"
    }, {
      label: "Implementation and Support",
      url: LIVE + "/implementation-and-support"
    }]
  }, {
    key: "solutions",
    label: "Solutions",
    items: [{
      label: "Skills-based hiring",
      url: LIVE + "/solutions/skills-based-hiring"
    }, {
      label: "Volume hiring",
      url: LIVE + "/solutions/volume-hiring"
    }, {
      label: "Professional Hiring",
      url: LIVE + "/solutions/professional-hiring"
    }, {
      label: "Early Careers",
      url: LIVE + "/solutions/early-careers"
    }]
  }, {
    key: "resources",
    label: "Resources",
    items: [{
      label: "Blog",
      page: "blog"
    }, {
      label: "Case Studies",
      url: LIVE + "/case-study-awe"
    }, {
      label: "Skills Leaders Network",
      page: "skills-leaders-network"
    }, {
      label: "Resource Library",
      url: LIVE + "/resources"
    }]
  }, {
    key: "company",
    label: "Company",
    items: [{
      label: "About us",
      url: LIVE + "/about-us"
    }, {
      label: "Our Dazzle",
      url: LIVE + "/our-dazzle"
    }, {
      label: "Careers",
      url: LIVE + "/careers-job"
    }]
  }];
  function itemHTML(it) {
    var cls = it.page ? "" : ' class="ext"'; // external (live-site) links get a grey hover
    return '<li><a href="' + itemHref(it) + '"' + cls + '>' + it.label + '</a></li>';
  }
  function submenuHTML(top) {
    var inner = "";
    if (top.groups) {
      top.groups.forEach(function (g) {
        if (g.heading) inner += '<li class="smh">' + g.heading + '</li>';
        g.items.forEach(function (it) {
          inner += itemHTML(it);
        });
      });
    } else {
      top.items.forEach(function (it) {
        inner += itemHTML(it);
      });
    }
    return '<ul class="submenu">' + inner + '</ul>';
  }
  class SZNav extends HTMLElement {
    connectedCallback() {
      var active = this.getAttribute("active") || "";
      var demoHref = this.getAttribute("demo-href") || "#";
      var demoLabel = this.getAttribute("demo-label") || "Book a demo";
      var blue = this.getAttribute("theme") === "blue";
      var logo = blue ? ASSETS + "/logo/sz-whiteblue.png" : ASSETS + "/logo/sz-blackblue.png";
      var activeColor = blue ? "var(--sz-yellow)" : "var(--sz-blue)";
      var demoClass = blue ? "btn btn-inverse btn-sm" : "btn btn-primary btn-sm";
      var links = NAV.map(function (top) {
        var style = top.key === active ? ' style="color:' + activeColor + '"' : "";
        return '<li class="has-menu"><a href="#"' + style + '>' + top.label + '</a>' + submenuHTML(top) + '</li>';
      }).join("");
      this.innerHTML = '<header class="nav' + (blue ? " on-blue" : "") + '">' + '<div class="wrap">' + '<a href="' + HOME + '"><img class="logo" src="' + logo + '" alt="Spotted Zebra"></a>' + '<ul class="nav-links">' + links + '</ul>' + '<button class="hamburger" aria-label="Menu"><span></span><span></span><span></span></button>' + '<a class="' + demoClass + '" href="' + demoHref + '">' + demoLabel + '</a>' + '</div>' + '</header>';
      var burger = this.querySelector(".hamburger");
      var menu = this.querySelector(".nav-links");
      burger.addEventListener("click", function () {
        menu.classList.toggle("open");
      });
    }
  }
  class SZFooter extends HTMLElement {
    connectedCallback() {
      var email = this.getAttribute("email") || "sales@spottedzebra.co.uk";
      this.innerHTML = '<footer>' + '<div class="wrap">' + '<img src="' + ASSETS + '/logo/sz-blackblue.png" alt="Spotted Zebra" style="height:28px">' + '<div class="links">' + '<a href="mailto:' + email + '">' + email + '</a>' + '<a href="#">Privacy Policy</a>' + '<span>20–22 Wenlock Road, London N1 7GU</span>' + '</div>' + '</div>' + '</footer>';
    }
  }
  class SZCta extends HTMLElement {
    connectedCallback() {
      var heading = this.getAttribute("heading") || "Spot the right hire, every time";
      var text = this.getAttribute("text");
      var button = this.getAttribute("button") || "Book a demo";
      var href = this.getAttribute("href") || "#";
      var wrapStyle = this.getAttribute("flush") === "true" ? "" : ' style="padding-bottom:var(--space-10)"';
      this.innerHTML = '<section class="wrap section"' + wrapStyle + '>' + '<div class="cta-band">' + '<h2>' + heading + '</h2>' + (text ? '<p>' + text + '</p>' : '') + '<a class="btn btn-inverse btn-lg" href="' + href + '">' + button + '</a>' + '</div>' + '</section>';
    }
  }
  customElements.define("sz-nav", SZNav);
  customElements.define("sz-footer", SZFooter);
  customElements.define("sz-cta", SZCta);
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "website/_components/site.js", error: String((e && e.message) || e) }); }

// website/discovery/_canvas/canvas.js
try { (() => {
/* Spotted Zebra — reusable discovery canvas.
   Usage: in a page-folder canvas.html, define window.CANVAS_CONFIG then load
   this script. It renders desktop + mobile previews of every variant, with
   zoom controls. The variant files are siblings of the canvas.html.

   window.CANVAS_CONFIG = {
     title: "Pricing — directions",
     description: "Optional intro line shown above the previews.",
     pages: [
       { file: "pricing-v1.html", label: "1 · Tiered",  sub: "Three tiers, monthly/annual toggle" },
       { file: "pricing-v2.html", label: "2 · Usage",   sub: "Usage-based with a calculator" },
       { file: "pricing-v3.html", label: "3 · Contact", sub: "Enterprise, request-a-quote led" }
     ]
   };

   Optional CONFIG keys:
     interactive: false       // freeze the previews (default is interactive/clickable)
     viewports: ["desktop"]    // which sizes to render; default ["desktop","mobile"]
*/
(function () {
  var DESKTOP = {
    w: 1280,
    scale: 0.42,
    kind: "desk"
  };
  var MOBILE = {
    w: 390,
    scale: 0.62,
    kind: "mob"
  };

  // Resolve the shared mobile-test harness sitting next to THIS script.
  var SELF = document.currentScript && document.currentScript.src || function () {
    var s = document.querySelectorAll('script[src$="canvas.js"]');
    return s.length ? s[s.length - 1].src : location.href;
  }();
  var MOBILE_TEST = new URL("mobile-test.html", SELF).href;
  function linkPill(label, href) {
    var a = el("a", "cv-open", label);
    a.href = href;
    a.target = "_self";
    a.style.cssText = "align-self:flex-start;display:inline-flex;align-items:center;gap:6px;padding:7px 13px;margin-bottom:10px;border:1.5px solid var(--border-strong);border-radius:var(--radius-pill);background:#fff;white-space:nowrap;";
    return a;
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // Assigned in render(): zoomAt(targetZoom, viewportX, viewportY) — focuses the
  // zoom on a point given in viewport (clientX/Y) coordinates.
  var zoomAt = null;
  function viewport(file, cfg, tag, interactive) {
    var vp = el("div", "cv-vp");
    vp.appendChild(el("span", "cv-tag", tag));
    var isMob = cfg.kind === "mob";
    var openHref = isMob ? MOBILE_TEST + "?src=" + encodeURIComponent(new URL(file, location.href).href) : file;
    vp.appendChild(linkPill(isMob ? "Open mobile test →" : "Open full page →", openHref));
    var shell = el("div", "cv-shell" + (cfg.kind === "mob" ? " mob" : ""));
    var inner = el("div", "cv-inner");
    var ifr = document.createElement("iframe");
    ifr.src = file;
    ifr.scrolling = "no";
    ifr.title = file;
    if (interactive) {
      ifr.scrolling = "auto";
      ifr.style.pointerEvents = "auto";
    }
    var SBW = cfg.kind === "mob" ? 0 : 18; // hide desktop scrollbar gutter
    var contentW = cfg.w + SBW; // iframe content width in its own CSS px
    ifr.style.width = contentW + "px";
    ifr.style.height = cfg.w * 1.6 + "px";
    ifr.style.transform = "scale(" + cfg.scale + ")";
    inner.style.width = cfg.w * cfg.scale + "px";
    inner.style.height = cfg.w * 1.6 * cfg.scale + "px";
    function fit() {
      try {
        var doc = ifr.contentDocument;
        var h = Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight);
        ifr.style.height = h + "px";
        inner.style.height = h * cfg.scale + "px";
      } catch (e) {}
    }
    ifr.addEventListener("load", function () {
      fit();
      setTimeout(fit, 500);
      setTimeout(fit, 1200);
      // Forward ⌘/Ctrl + scroll from inside the page out to the canvas zoom, so
      // zooming works while the cursor is hovering a preview (not just the gaps).
      try {
        ifr.contentDocument.addEventListener("wheel", function (e) {
          if (!(e.ctrlKey || e.metaKey) || !zoomAt) return;
          e.preventDefault();
          var rect = ifr.getBoundingClientRect();
          var ratio = rect.width / contentW; // CSS px → viewport px
          var vx = rect.left + e.clientX * ratio;
          var vy = rect.top + e.clientY * ratio;
          zoomAt(curZoom() - e.deltaY * 0.002, vx, vy);
        }, {
          passive: false
        });
      } catch (e) {}
    });
    inner.appendChild(ifr);
    shell.appendChild(inner);
    vp.appendChild(shell);
    return vp;
  }
  var curZoom = function () {
    return 1;
  }; // replaced in render()

  function render() {
    var cfg = window.CANVAS_CONFIG || {
      title: "Canvas",
      description: "",
      pages: []
    };
    var interactive = cfg.interactive !== false; // interactive by default
    var vps = cfg.viewports || ["desktop", "mobile"];

    // Zoom bar
    var zb = el("div", "cv-zoombar");
    var zout = el("button", null, "−");
    zout.title = "Zoom out";
    var zlabel = el("span", "cv-zlabel", "100%");
    var zin = el("button", null, "+");
    zin.title = "Zoom in";
    var zreset = el("button", null, "Reset");
    zreset.title = "Reset";
    zreset.style.cssText = "font-size:13px;width:auto;padding:0 10px;border-radius:14px";
    var hint = el("span", "cv-hint", interactive ? "live · ⌘/Ctrl + scroll to zoom" : "⌘/Ctrl + scroll");
    zb.appendChild(zout);
    zb.appendChild(zlabel);
    zb.appendChild(zin);
    zb.appendChild(zreset);
    zb.appendChild(hint);
    document.body.appendChild(zb);

    // Canvas
    var canvas = el("div", "cv-canvas");
    var head = el("div", "cv-head");
    head.appendChild(el("h1", null, cfg.title || "Canvas"));
    if (cfg.description) head.appendChild(el("p", null, cfg.description));
    canvas.appendChild(head);
    var row = el("div", "cv-row");
    (cfg.pages || []).forEach(function (p) {
      var cell = el("div", "cv-cell");
      cell.appendChild(el("div", "cv-label", p.label || p.file));
      if (p.sub) cell.appendChild(el("div", "cv-sub", p.sub));
      var prev = el("div", "cv-previews");
      vps.forEach(function (v) {
        var isMob = v === "mobile";
        prev.appendChild(viewport(p.file, isMob ? MOBILE : DESKTOP, isMob ? "Mobile" : "Desktop", interactive));
      });
      cell.appendChild(prev);
      row.appendChild(cell);
    });
    canvas.appendChild(row);
    document.body.appendChild(canvas);

    // Zoom behaviour — focuses on a viewport point so the spot under the cursor
    // (or the screen centre, for the buttons) stays put while zooming.
    var z = 1;
    curZoom = function () {
      return z;
    };
    function centreX() {
      return window.innerWidth / 2;
    }
    function centreY() {
      return window.innerHeight / 2;
    }
    zoomAt = function (target, vx, vy) {
      var zNew = Math.min(2.5, Math.max(0.3, target));
      if (zNew === z) return;
      var ratio = zNew / z;
      var sx = window.scrollX,
        sy = window.scrollY;
      canvas.style.zoom = zNew;
      // Keep the (vx,vy) viewport point anchored to the same content under it.
      window.scrollTo((sx + vx) * ratio - vx, (sy + vy) * ratio - vy);
      z = zNew;
      zlabel.textContent = Math.round(z * 100) + "%";
    };
    zin.onclick = function () {
      zoomAt(z + 0.1, centreX(), centreY());
    };
    zout.onclick = function () {
      zoomAt(z - 0.1, centreX(), centreY());
    };
    zreset.onclick = function () {
      zoomAt(1, centreX(), centreY());
    };
    // Cursor over the canvas gaps (not over a preview): zoom toward the cursor.
    window.addEventListener("wheel", function (e) {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoomAt(z - e.deltaY * 0.002, e.clientX, e.clientY);
      }
    }, {
      passive: false
    });
    if (cfg.title) document.title = cfg.title;
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);else render();
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "website/discovery/_canvas/canvas.js", error: String((e && e.message) || e) }); }

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Logo = __ds_scope.Logo;

__ds_ns.Spot = __ds_scope.Spot;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.Quote = __ds_scope.Quote;

__ds_ns.StatBlock = __ds_scope.StatBlock;

__ds_ns.Table = __ds_scope.Table;

__ds_ns.Avatar = __ds_scope.Avatar;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Eyebrow = __ds_scope.Eyebrow;

__ds_ns.Tag = __ds_scope.Tag;

})();

import { useId } from "react";

/** Resolution-independent V and orbital light, based on the owner's supplied artwork. */
export default function VanteloqAiLogo({ size = 48, className = "", decorative = false, thinking = false, active = false }: { size?: number; className?: string; decorative?: boolean; thinking?: boolean; active?: boolean }) {
  const id = "vai-" + useId().replace(/:/g, "");
  const paint = (name: string) => "url(#" + id + "-" + name + ")";
  return <span className={"vanteloq-ai-logo " + (size < 40 ? "is-compact " : "") + (thinking ? "is-thinking " : active ? "is-attentive " : "") + className} style={{ width: size, height: size }} role={decorative ? undefined : "img"} aria-label={decorative ? undefined : "Vanteloq AI logo"} aria-hidden={decorative || undefined}>
    <svg viewBox="0 0 160 160" fill="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={id + "-left"} x1="33" y1="32" x2="101" y2="139" gradientUnits="userSpaceOnUse"><stop stopColor="#8CC6FF"/><stop offset=".2" stopColor="#3265CC"/><stop offset=".55" stopColor="#18386E"/><stop offset=".86" stopColor="#3858B3"/><stop offset="1" stopColor="#9175EC"/></linearGradient>
        <linearGradient id={id + "-right"} x1="116" y1="28" x2="89" y2="125" gradientUnits="userSpaceOnUse"><stop stopColor="#CCE9FF"/><stop offset=".22" stopColor="#5AB1FF"/><stop offset=".5" stopColor="#3275E8"/><stop offset=".8" stopColor="#6659DB"/><stop offset="1" stopColor="#AD94F2"/></linearGradient>
        <linearGradient id={id + "-edge"} x1="32" y1="30" x2="129" y2="123" gradientUnits="userSpaceOnUse"><stop stopColor="#DAF4FF"/><stop offset=".36" stopColor="#2990FF"/><stop offset=".74" stopColor="#68BFFF"/><stop offset="1" stopColor="#C3A9FF"/></linearGradient>
        <linearGradient id={id + "-orbit"} x1="12" y1="113" x2="147" y2="52" gradientUnits="userSpaceOnUse"><stop stopColor="#8D72F4"/><stop offset=".35" stopColor="#247DF4"/><stop offset=".7" stopColor="#51B9FF"/><stop offset="1" stopColor="#BCDFFF"/></linearGradient>
        <linearGradient id={id + "-flow"} x1="0" y1="140" x2="160" y2="0" gradientUnits="userSpaceOnUse"><stop stopColor="#476AFF" stopOpacity="0"/><stop offset=".35" stopColor="#8064E8" stopOpacity=".65"/><stop offset=".55" stopColor="#A3D8FF" stopOpacity=".65"/><stop offset=".72" stopColor="#327FFF" stopOpacity=".15"/><stop offset="1" stopColor="#476AFF" stopOpacity="0"/></linearGradient>
        <clipPath id={id + "-face"}><path d="M29 31H61L105 128H77ZM109 31H141L101 119L85 83Z"/></clipPath>
        <filter id={id + "-glow"} x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="1.7"/></filter>
      </defs>
      <g transform="translate(-4 0)"><g className="vai-core">
        <ellipse className="vai-orbit-back" cx="80" cy="84" rx="69" ry="25" transform="rotate(-24 80 84)" stroke={paint("orbit")} strokeWidth="1.6" opacity=".48"/>
        <path d="M29 31H61L105 128H77Z" fill={paint("left")} stroke={paint("edge")} strokeWidth="1.2"/>
        <path d="M61 31L105 128H97L54 32Z" fill="#061B46" opacity=".6"/>
        <path d="M109 31H141L101 119L85 83Z" fill={paint("right")} stroke={paint("edge")} strokeWidth="1.35"/>
        <g clipPath={paint("face")}><path className="vai-colour-flow" d="M-80-80H240V240H-80Z" fill={paint("flow")}/></g>
        <path d="M112 35H134L101 107L90 83Z" fill="none" stroke="#BFDDFF" strokeWidth=".65" opacity=".22"/>
        <path d="M30 32H60M110 32H139M78 126H101M88 83L101 114" stroke="#DBF4FF" strokeWidth="1.35" strokeLinecap="round" opacity=".86"/>
        <path d="M17 112C29 139 159 79 143 56" stroke={paint("orbit")} strokeWidth="2.5" filter={paint("glow")} opacity=".7"/>
        <path d="M17 112C29 139 159 79 143 56" stroke={paint("orbit")} strokeWidth="1.5" strokeLinecap="round"/>
        <g transform="translate(80 84) rotate(-24) scale(1 .3623)">
          <g className="vai-orbit-spin">
            <circle r="69" stroke="#71BDFF" strokeWidth="2.1" strokeDasharray="25 409" opacity=".8"/>
            <g transform="translate(69 0) scale(1 2.76)"><circle r="4.8" fill="#6ABFFF" filter={paint("glow")} opacity=".85"/><circle className="vai-satellite" r="2.5" fill="#E4F7FF" stroke="#4DA8FF" strokeWidth=".8"/></g>
          </g>
        </g>
      </g></g>
    </svg>
  </span>;
}

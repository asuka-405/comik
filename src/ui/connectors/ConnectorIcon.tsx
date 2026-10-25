import { useState } from "react";

/** A connector's logo, or its first letters when it has none or the picture does not load. */
export function ConnectorIcon({ icon, name, size = 36 }: { icon?: string; name: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (icon && !failed) {
    return <img className="connector-icon" src={icon} alt="" width={size} height={size} referrerPolicy="no-referrer" loading="lazy" decoding="async" onError={() => setFailed(true)} />;
  }
  return <span className="connector-icon fallback" style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }} aria-hidden="true">{name.slice(0, 2)}</span>;
}

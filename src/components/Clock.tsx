"use client";

import { useEffect, useState } from "react";

export default function Clock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const p = (n: number) => String(n).padStart(2, "0");
  const days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

  return (
    <div>
      <div className="clock" style={{ fontSize: 26, letterSpacing: ".06em", color: "#f0ecff", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
        {now ? `${p(now.getHours())}:${p(now.getMinutes())}` : "--:--"}
        <small style={{ fontSize: 12, color: "var(--dim)" }}>:{now ? p(now.getSeconds()) : "--"}</small>
      </div>
      <div style={{ fontSize: 8.5, letterSpacing: ".24em", color: "var(--dimmer)", textAlign: "right", marginTop: 4 }}>
        {now ? `${days[now.getDay()]} ${now.getDate()} ${months[now.getMonth()]}` : "— —"}
      </div>
    </div>
  );
}

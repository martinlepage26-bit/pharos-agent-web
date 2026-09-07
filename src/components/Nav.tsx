"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS: Array<{ href: string; label: string }> = [
  { href: "/", label: "DASHBOARD" },
  { href: "/graph", label: "GRAPH" },
  { href: "/runs", label: "RUNS" },
  { href: "/briefs", label: "BRIEFS" },
  { href: "/sources", label: "SOURCES" },
  { href: "/search", label: "SEARCH" },
  { href: "/register", label: "REGISTER" },
];

export default function Nav() {
  const pathname = usePathname();
  return (
    <nav className="mainnav">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} className={pathname === l.href ? "active" : ""}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

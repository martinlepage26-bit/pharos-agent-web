import type { Metadata } from "next";
import "./globals.css";
import Clock from "@/components/Clock";
import Nav from "@/components/Nav";

export const metadata: Metadata = {
  title: "PHAROS Agent — Control Center",
  description: "Governed personal operations agent. Localhost only.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr-CA">
      <body>
        <div className="site-aurora" aria-hidden="true" />
        <div id="app">
          <header className="masthead">
            <div>
              <div className="word">P H A R O S</div>
              <div className="sub">GOVERNED OPERATIONS AGENT · BRIEFS · AUDIT · SIGNAL</div>
            </div>
            <div className="pills">
              <div className="pill"><i className="dot" />DB · LIVE</div>
              <div className="pill"><i className="dot" />VAULT · LINKED</div>
              <div className="pill"><i className="dot warm" />LOCALHOST · ONLY</div>
            </div>
            <Clock />
          </header>
          <Nav />
          {children}
        </div>
      </body>
    </html>
  );
}

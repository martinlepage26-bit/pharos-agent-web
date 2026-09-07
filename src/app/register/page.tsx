export const metadata = { title: "Register — PHAROS Agent" };

/**
 * The Project Control shared register, wired in. Served live by
 * /api/register from ~/Documents/project-control.html — edits to the
 * register appear on refresh, no rebuild.
 */
export default function RegisterPage() {
  return (
    <main className="register">
      <div className="reg-head">
        <span>PROJECT CONTROL — SHARED REGISTER</span>
        <em>LIVE · ~/DOCUMENTS/PROJECT-CONTROL.HTML</em>
        <a href="/api/register" target="_blank" rel="noreferrer">
          OPEN STANDALONE ↗
        </a>
      </div>
      <iframe src="/api/register" title="Project Control — shared register" />
    </main>
  );
}

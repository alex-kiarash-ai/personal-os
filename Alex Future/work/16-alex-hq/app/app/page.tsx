import { getSummary, getInbox } from "@/lib/hq";
import { Dashboard } from "./dashboard";

export const revalidate = 60;

export default async function Home() {
  const [s, inbox] = await Promise.all([getSummary(), getInbox()]);
  const now = Date.now();

  if (!s) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center gap-4 p-8 text-center">
        <span className="kicker">Alex HQ</span>
        <h1 className="big">Backend unreachable</h1>
        <p className="text-sm" style={{ color: "var(--mute)" }}>
          The summary endpoint didn&apos;t answer. Check the n8n box or the token in .env.local.
        </p>
      </main>
    );
  }

  return <Dashboard summary={s} now={now} inbox={inbox} />;
}

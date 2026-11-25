import { createRoot } from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Toaster } from "sonner";
import { Analytics } from "@vercel/analytics/react";
import { detectLocale } from "../core/i18n.ts";
import { setLocale } from "../i18n/index.ts";
import { SparkShell } from "../ui/shell.tsx";
import { SparkSplash } from "../ui/splash.tsx";
import { attachMcp } from "./mcp.ts";
import { createRuntime } from "./runtime.ts";
import { report } from "../ui/errors.ts";
import "dockview-react/dist/styles/dockview.css";
import "./theme.css";

document.documentElement.classList.add("dark");
setLocale(detectLocale(navigator.languages ?? [navigator.language]));

const root = createRoot(document.getElementById("root")!);
const splashSlot = document.createElement("div");
splashSlot.className = "spark-splash-slot";
document.body.append(splashSlot);
const splashRoot = createRoot(splashSlot);
splashRoot.render(<SparkSplash />);

/** Durée minimale du splash : la séquence de dessin doit se lire en entier. */
const minimumSplash = 1200;
const exitFade = 200;
const bootedAt = performance.now();
const wait = (delay: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, delay));

async function start() {
  const runtime = await createRuntime();
  await attachMcp(runtime).catch(report);
  const window = getCurrentWindow();
  let closing = false;
  await window.onCloseRequested(async (event) => {
    event.preventDefault();
    if (closing) return;
    closing = true;
    try {
      await runtime.persistence.flush();
      await window.destroy();
    } catch (error) {
      report(error);
      closing = false;
    }
  });
  root.render(
    <>
      <SparkShell runtime={runtime} />
      <Toaster theme="system" position="bottom-right" />
      <Analytics />
    </>,
  );
  await wait(Math.max(0, minimumSplash - (performance.now() - bootedAt)));
  splashSlot.classList.add("spark-splash-exit");
  await wait(exitFade);
  splashRoot.unmount();
  splashSlot.remove();
}
void start().catch((error) => {
  splashRoot.render(<SparkSplash error={String(error)} />);
});

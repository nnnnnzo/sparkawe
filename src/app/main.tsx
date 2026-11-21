import { createRoot } from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Toaster } from "sonner";
import { LabShell } from "../ui/shell.tsx";
import { attachMcp } from "./mcp.ts";
import { createRuntime } from "./runtime.ts";
import { report } from "../ui/errors.ts";
import "dockview-react/dist/styles/dockview.css";
import "./theme.css";

const root = createRoot(document.getElementById("root")!);
document.documentElement.classList.add("dark");
root.render(
  <p role="status" className="tile-message">
    Ouverture de Lab…
  </p>,
);

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
      <LabShell runtime={runtime} />
      <Toaster theme="system" position="bottom-right" />
    </>,
  );
}
void start().catch((error) => {
  root.render(
    <p role="alert" className="tile-message">
      Ouverture de Lab impossible. {String(error)}
    </p>,
  );
});

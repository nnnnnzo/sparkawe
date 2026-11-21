import { Blocks, Copy, Settings2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import type { Runtime } from "../app/runtime.ts";
import type { Theme } from "../core/workspace.ts";
import type { Command, Manifest } from "../sdk/index.ts";
import { report } from "./errors.ts";
import { Button } from "@spark/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@spark/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@spark/ui/components/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@spark/ui/components/popover";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@spark/ui/components/sidebar";
import { Icon } from "./icons.tsx";
import { BRAND, SparkLockup, Spectrum } from "../shared/brand/index.tsx";

const macOS = navigator.platform.toLowerCase().includes("mac");

interface AgentLink {
  command: string;
  available: boolean;
  config: string;
}

function ExtensionButton({
  extension,
  commands,
  run,
}: {
  extension: Manifest;
  commands: Command[];
  run: (command: Command) => void;
}) {
  const [open, setOpen] = useState<"hover" | "click" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancel = () => clearTimeout(timer.current);
  const away = () => {
    timer.current = setTimeout(
      () => setOpen((value) => (value === "hover" ? null : value)),
      180,
    );
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <SidebarMenuItem>
      <Popover
        open={!!open}
        onOpenChange={(value) => setOpen(value ? "click" : null)}
      >
        <PopoverTrigger asChild>
          <SidebarMenuButton
            aria-label={extension.name}
            title={extension.name}
            onPointerEnter={(event) => {
              if (event.pointerType !== "mouse") return;
              cancel();
              setOpen((value) => value ?? "hover");
            }}
            onPointerLeave={away}
            onClick={(event) => {
              if (open === "hover") {
                event.preventDefault();
                setOpen("click");
              }
            }}
          >
            <Icon glyph={extension.icon} extension={extension} />
          </SidebarMenuButton>
        </PopoverTrigger>
        <PopoverContent
          side="right"
          align="start"
          sideOffset={9}
          className="w-52 p-1.5"
          aria-label={extension.name}
          onOpenAutoFocus={(event) => {
            if (open === "hover") event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            if (open !== "click") event.preventDefault();
          }}
          onPointerEnter={cancel}
          onPointerLeave={away}
        >
          {commands.map((command) => (
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              key={command.id}
              onClick={() => {
                setOpen(null);
                run(command);
              }}
            >
              <Icon glyph={command.icon} extension={extension} />
              {command.title}
            </Button>
          ))}
        </PopoverContent>
      </Popover>
    </SidebarMenuItem>
  );
}

export function Rail({
  runtime,
  run,
  pinned,
  theme,
  dev,
  onOpenStore,
}: {
  runtime: Runtime;
  run: (command: Command) => void;
  pinned: string[] | null;
  theme: Theme;
  dev: boolean;
  onOpenStore: () => void;
}) {
  const [about, setAbout] = useState(false);
  const [agent, setAgent] = useState(false);
  const [link, setLink] = useState<AgentLink | null>(null);
  const [copied, setCopied] = useState(false);
  const catalog = runtime.extensions.catalog;
  const activeIds = new Set(
    runtime.registry.getExtensions().map(({ id }) => id),
  );
  const selected = pinned ?? catalog.map(({ id }) => id);
  const commands = runtime.registry.getCommands();
  const tileCommands = commands.filter((command) => command.tileType);

  useEffect(() => {
    if (!agent) return;
    let alive = true;
    invoke<AgentLink>("mcp_link")
      .then((value) => {
        if (alive) setLink(value);
      })
      .catch(report);
    return () => {
      alive = false;
    };
  }, [agent]);
  useEffect(() => {
    const open = () => setAgent(true);
    window.addEventListener("spark:connect-agent", open);
    return () => window.removeEventListener("spark:connect-agent", open);
  }, []);
  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.config);
    } catch {
      // Certains webviews refusent l'API presse-papiers : repli sans plugin.
      const area = document.createElement("textarea");
      area.value = link.config;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.append(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }
  return (
    <aside className="spark-rail" aria-label="Extensions">
      <Sidebar variant="floating" collapsible="icon">
        <SidebarContent>
          <SidebarMenu className="items-center pt-1.5">
            {catalog
              .filter(
                (extension) =>
                  activeIds.has(extension.id) &&
                  selected.includes(extension.id) &&
                  tileCommands.some(
                    (command) => command.owner.id === extension.id,
                  ),
              )
              .map((extension) => (
                <ExtensionButton
                  key={extension.id}
                  extension={extension}
                  run={run}
                  commands={tileCommands.filter(
                    (command) => command.owner.id === extension.id,
                  )}
                />
              ))}
          </SidebarMenu>
        </SidebarContent>
        <SidebarFooter className="items-center px-0 pb-1.5">
          <SidebarMenu className="items-center">
            <SidebarMenuItem>
              <SidebarMenuButton
                id="store-trigger"
                tooltip="Store"
                aria-label="Ouvrir le store d’extensions"
                onClick={onOpenStore}
              >
                <Blocks strokeWidth={1.7} />
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton
                    tooltip="Paramètres"
                    aria-label="Paramètres"
                  >
                    <Settings2 strokeWidth={1.7} />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="right" align="end">
                  <DropdownMenuGroup>
                    <DropdownMenuRadioGroup
                      value={theme}
                      onValueChange={(value) =>
                        runtime.workspace.patch({ theme: value as Theme })
                      }
                    >
                      <DropdownMenuRadioItem value="light">
                        Thème clair
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="dark">
                        Thème sombre
                      </DropdownMenuRadioItem>
                      {macOS && (
                        <DropdownMenuRadioItem value="transparent">
                          Thème transparent
                        </DropdownMenuRadioItem>
                      )}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuCheckboxItem
                      checked={dev}
                      onCheckedChange={(value) =>
                        runtime.settings.patch({ dev: value === true })
                      }
                    >
                      Mode développeur
                    </DropdownMenuCheckboxItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem onSelect={() => setAgent(true)}>
                      Connecter un agent…
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem onSelect={() => setAbout(true)}>
                      À propos de {BRAND.name}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <Dialog open={agent} onOpenChange={setAgent}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Connecter un agent</DialogTitle>
            <DialogDescription>
              Déclarez ce serveur MCP dans Claude Code, Codex ou Cursor. Le pont
              relaie les outils vers cette fenêtre ; aucun port réseau n’est
              ouvert.
            </DialogDescription>
          </DialogHeader>
          {link ? (
            <div className="flex flex-col gap-4">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-muted-foreground text-xs">Commande</span>
                <code className="bg-muted wrap-anywhere rounded-md px-2 py-1.5 font-mono text-xs">
                  {link.command}
                </code>
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-muted-foreground text-xs">
                  Configuration MCP
                </span>
                <pre className="bg-muted wrap-anywhere rounded-md p-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                  {link.config}
                </pre>
              </div>
              {!link.available && (
                <p className="text-destructive text-xs">
                  Le pont n’est pas encore construit. Lancez{" "}
                  <code>npm run sidecar</code>.
                </p>
              )}
              <Button
                variant="secondary"
                size="sm"
                className="self-end"
                onClick={() => void copyLink()}
              >
                <Copy data-icon="inline-start" />
                {copied ? "Configuration copiée" : "Copier la configuration"}
              </Button>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">Lecture…</p>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={about} onOpenChange={setAbout}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="sr-only">
              À propos de {BRAND.name}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-5 py-1">
            <SparkLockup
              variant={theme === "light" ? "mono" : "color"}
              className="spark-about-lockup"
            />
            <div className="flex flex-col gap-2">
              <span className="spark-kicker">{BRAND.descriptor}</span>
              <p className="text-muted-foreground text-xs leading-relaxed">
                Un environnement de travail modulaire où les personnes, les
                outils et les agents partagent un même espace.
              </p>
            </div>
            <Spectrum />
            <p className="text-muted-foreground text-[11px]">{BRAND.tagline}</p>
          </div>
        </DialogContent>
      </Dialog>
    </aside>
  );
}

import { Blocks, Copy, Settings2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import type { Runtime } from "../app/runtime.ts";
import { LOCALES, LANGUAGES, type Locale } from "../core/i18n.ts";
import type { Theme } from "../core/workspace.ts";
import type { Command, Manifest } from "../sdk/index.ts";
import { useI18n } from "../i18n/react.ts";
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
  open,
  mode,
  onEnter,
  onLeave,
  onPin,
  onClose,
}: {
  extension: Manifest;
  commands: Command[];
  run: (command: Command) => void;
  open: boolean;
  mode: "hover" | "click" | null;
  onEnter: () => void;
  onLeave: () => void;
  onPin: () => void;
  onClose: () => void;
}) {
  const { text } = useI18n();
  return (
    <SidebarMenuItem>
      <Popover
        open={open}
        onOpenChange={(value) => {
          if (!value) onClose();
        }}
      >
        <PopoverTrigger asChild>
          <SidebarMenuButton
            aria-label={text(extension.name)}
            onPointerEnter={(event) => {
              if (event.pointerType !== "mouse") return;
              onEnter();
            }}
            onPointerLeave={onLeave}
            onClick={(event) => {
              event.preventDefault();
              if (mode === "click") onClose();
              else onPin();
            }}
          >
            <Icon glyph={extension.icon} extension={extension} />
          </SidebarMenuButton>
        </PopoverTrigger>
        <PopoverContent
          side="right"
          align="start"
          sideOffset={9}
          className="max-h-[var(--radix-popover-content-available-height)] w-64 overflow-y-auto p-1.5"
          aria-label={text(extension.name)}
          onOpenAutoFocus={(event) => {
            if (mode === "hover") event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            if (mode !== "click") event.preventDefault();
          }}
          onPointerEnter={onEnter}
          onPointerLeave={onLeave}
        >
          {commands.map((command) => (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto min-h-8 w-full min-w-0 justify-start gap-2 px-2 py-1.5 text-left whitespace-normal"
              key={command.id}
              onClick={() => {
                onClose();
                run(command);
              }}
            >
              <Icon glyph={command.icon} extension={extension} />
              <span className="min-w-0 flex-1 break-words">
                {text(command.title)}
              </span>
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
  const [extensionMenu, setExtensionMenu] = useState<{
    id: string;
    mode: "hover" | "click";
  } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const clearClose = () => clearTimeout(closeTimer.current);
  const enterExtension = (id: string) => {
    clearClose();
    setExtensionMenu((current) =>
      current?.id === id ? current : { id, mode: "hover" },
    );
  };
  const leaveExtension = (id: string) => {
    clearClose();
    closeTimer.current = setTimeout(() => {
      setExtensionMenu((current) =>
        current?.id === id && current.mode === "hover" ? null : current,
      );
    }, 180);
  };
  const pinExtension = (id: string) => {
    clearClose();
    setExtensionMenu({ id, mode: "click" });
  };
  const closeExtension = (id: string) => {
    clearClose();
    setExtensionMenu((current) => (current?.id === id ? null : current));
  };
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  const [link, setLink] = useState<AgentLink | null>(null);
  const [copied, setCopied] = useState(false);
  const { t, locale } = useI18n();
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
    <aside className="spark-rail" aria-label={t("rail.extensions")}>
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
                  open={extensionMenu?.id === extension.id}
                  mode={
                    extensionMenu?.id === extension.id
                      ? extensionMenu.mode
                      : null
                  }
                  onEnter={() => enterExtension(extension.id)}
                  onLeave={() => leaveExtension(extension.id)}
                  onPin={() => pinExtension(extension.id)}
                  onClose={() => closeExtension(extension.id)}
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
                tooltip={t("rail.store")}
                aria-label={t("rail.store")}
                onClick={onOpenStore}
              >
                <Blocks strokeWidth={1.7} />
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton
                    tooltip={t("rail.settings")}
                    aria-label={t("rail.settings")}
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
                        {t("rail.theme.light")}
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="dark">
                        {t("rail.theme.dark")}
                      </DropdownMenuRadioItem>
                      {macOS && (
                        <DropdownMenuRadioItem value="transparent">
                          {t("rail.theme.transparent")}
                        </DropdownMenuRadioItem>
                      )}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <span className="language-flag" aria-hidden>
                        {LANGUAGES[locale].flag}
                      </span>
                      <span>{t("rail.language")}</span>
                      <span
                        className="text-muted-foreground text-xs"
                        lang={locale}
                      >
                        {LANGUAGES[locale].native}
                      </span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="min-w-52">
                      <DropdownMenuRadioGroup
                        value={locale}
                        aria-label={t("rail.language.group")}
                        onValueChange={(value) =>
                          runtime.settings.patch({ locale: value as Locale })
                        }
                      >
                        {LOCALES.map((language) => (
                          <DropdownMenuRadioItem
                            key={language}
                            value={language}
                          >
                            <span className="language-flag" aria-hidden>
                              {LANGUAGES[language].flag}
                            </span>
                            <span lang={language}>
                              {LANGUAGES[language].native}
                            </span>
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuCheckboxItem
                      checked={dev}
                      onCheckedChange={(value) =>
                        runtime.settings.patch({ dev: value === true })
                      }
                    >
                      {t("rail.dev")}
                    </DropdownMenuCheckboxItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem onSelect={() => setAgent(true)}>
                      {t("rail.agent.connect")}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem onSelect={() => setAbout(true)}>
                      {t("rail.about", { name: BRAND.name })}
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
            <DialogTitle>{t("rail.agent.title")}</DialogTitle>
            <DialogDescription>{t("rail.agent.description")}</DialogDescription>
          </DialogHeader>
          {link ? (
            <div className="flex flex-col gap-4">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-muted-foreground text-xs">
                  {t("rail.agent.command")}
                </span>
                <code className="bg-muted wrap-anywhere rounded-md px-2 py-1.5 font-mono text-xs">
                  {link.command}
                </code>
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-muted-foreground text-xs">
                  {t("rail.agent.config")}
                </span>
                <pre className="bg-muted wrap-anywhere rounded-md p-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                  {link.config}
                </pre>
              </div>
              {!link.available && (
                <p className="text-destructive text-xs">
                  {t("rail.agent.missing", { command: "npm run sidecar" })}
                </p>
              )}
              <Button
                variant="secondary"
                size="sm"
                className="self-end"
                onClick={() => void copyLink()}
              >
                <Copy data-icon="inline-start" />
                {copied ? t("rail.agent.copied") : t("rail.agent.copy")}
              </Button>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              {t("rail.agent.loading")}
            </p>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={about} onOpenChange={setAbout}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="sr-only">
              {t("rail.about", { name: BRAND.name })}
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
                {t("rail.about.description")}
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

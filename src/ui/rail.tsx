import { Blocks, Check, Pin, Settings2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Runtime } from "../app/runtime.ts";
import type { Theme } from "../core/workspace.ts";
import type { Command, Manifest } from "../sdk/index.ts";
import { report } from "./errors.ts";
import { Button } from "@lab/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@lab/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@lab/ui/components/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@lab/ui/components/popover";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@lab/ui/components/sidebar";
import { Icon } from "./icons.tsx";

const macOS = navigator.platform.toLowerCase().includes("mac");

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
  hub,
  setHub,
}: {
  runtime: Runtime;
  run: (command: Command) => void;
  pinned: string[] | null;
  theme: Theme;
  dev: boolean;
  hub: boolean;
  setHub: (open: boolean) => void;
}) {
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const catalog = runtime.extensions.catalog;
  const activeIds = new Set(
    runtime.registry.getExtensions().map(({ id }) => id),
  );
  const selected = pinned ?? catalog.map(({ id }) => id);
  const commands = runtime.registry.getCommands();
  const tileCommands = commands.filter((command) => command.tileType);

  async function setEnabled(id: string, enabled: boolean) {
    setPending((current) => new Set([...current, id]));
    try {
      await runtime.extensions.setEnabled(id, enabled);
    } catch (error) {
      report(error);
    } finally {
      setPending(
        (current) => new Set([...current].filter((item) => item !== id)),
      );
    }
  }
  return (
    <aside className="lab-rail" aria-label="Extensions">
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
                tooltip="Extensions"
                aria-label="Gérer les extensions"
                onClick={() => setHub(true)}
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
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <Dialog open={hub} onOpenChange={setHub}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Extensions</DialogTitle>
            <DialogDescription className="sr-only">
              Activer les extensions et les épingler à la barre latérale.
            </DialogDescription>
          </DialogHeader>
          {catalog.length === 0 && <p>Aucune extension disponible.</p>}
          <ul className="flex max-h-[60vh] flex-col gap-2 overflow-auto">
            {catalog.map((extension) => {
              const active = activeIds.has(extension.id);
              const busy = pending.has(extension.id);
              const isPinned = selected.includes(extension.id);
              const canPin = tileCommands.some(
                (command) => command.owner.id === extension.id,
              );
              const action = active ? "Désactiver" : "Activer";
              return (
                <li
                  key={extension.id}
                  className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2"
                >
                  <Icon glyph={extension.icon} extension={extension} />
                  <div className="mr-auto flex flex-col">
                    <span>{extension.name}</span>
                    <span className="text-muted-foreground text-xs">
                      {extension.version} · {active ? "Active" : "Inactive"}
                    </span>
                  </div>
                  {active && canPin && (
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={busy}
                      aria-pressed={isPinned}
                      title={isPinned ? "Désépingler" : "Épingler"}
                      aria-label={`${isPinned ? "Désépingler" : "Épingler"} ${extension.name}`}
                      onClick={() =>
                        runtime.workspace.patch({
                          pinned: isPinned
                            ? selected.filter((id) => id !== extension.id)
                            : [...selected, extension.id],
                        })
                      }
                    >
                      {isPinned ? (
                        <Check data-icon="inline-start" />
                      ) : (
                        <Pin data-icon="inline-start" />
                      )}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    aria-label={`${action} ${extension.name}`}
                    onClick={() => void setEnabled(extension.id, !active)}
                  >
                    {busy
                      ? active
                        ? "Désactivation…"
                        : "Activation…"
                      : action}
                  </Button>
                </li>
              );
            })}
          </ul>
        </DialogContent>
      </Dialog>
    </aside>
  );
}

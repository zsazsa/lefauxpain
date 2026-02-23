import type { Component } from "solid-js";

export type SidebarEntry = {
  id: string;
  component: Component;
  visible: () => boolean;
};

const sidebarApplets: SidebarEntry[] = [];

export function registerSidebarApplet(entry: SidebarEntry) {
  sidebarApplets.push(entry);
}

export function getSidebarApplets(): SidebarEntry[] {
  return sidebarApplets;
}

/**
 * The kinds of stations the center rents out, and how each is shown.
 * Add a new type here (and in the server's CONSOLE_TYPES + a migration) and
 * every filter, form, chart and badge picks it up.
 *
 * Colours are fixed per type (never by position), taken in order from the
 * validated categorical palette: blue, orange, aqua, yellow.
 */
import { CarFront, Gamepad2, Glasses, type LucideIcon } from 'lucide-react';
import type { ConsoleType } from '../types';

export const CONSOLE_TYPES: ConsoleType[] = ['PS5', 'PS4', 'STEERING', 'VR'];

export const CONSOLE_TYPE_META: Record<ConsoleType, { label: string; color: string; icon: LucideIcon }> = {
  PS5: { label: 'PS5', color: '#2a78d6', icon: Gamepad2 },
  PS4: { label: 'PS4', color: '#eb6834', icon: Gamepad2 },
  STEERING: { label: 'Steering Wheel', color: '#1baf7a', icon: CarFront },
  VR: { label: 'VR', color: '#eda100', icon: Glasses },
};

export const consoleTypeLabel = (t: ConsoleType | null | undefined) => (t ? CONSOLE_TYPE_META[t]?.label ?? t : '');

import { supabase } from "./supabase";

export function useAction<T>(fn: T): T {
  return fn;
}

export async function adStatusOptions(_args?: any): Promise<string[]> {
  return [
    "Active",
    "Paused",
    "Testing",
    "Scaling",
    "Dead Campaign",
    "Lost Client",
    "Review",
  ];
}

export async function setAdStatus(args: {
  campaignName: string;
  status: string;
  taskId?: string;
  clientTag?: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from("cockpit_campaigns")
      .update({ status: args.status })
      .ilike("campaign_name", args.campaignName);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function renameCard(_args: {
  campaignName: string;
}): Promise<{ ok: boolean; error?: string }> {
  return { ok: true };
}

export async function addToBoard(_args: {
  campaignName: string;
  client?: string;
  clientName?: string;
  [key: string]: any;
}): Promise<{ ok: boolean; error?: string }> {
  return { ok: true };
}

export async function dismissOffBoard(_args: {
  campaignName: string;
}): Promise<{ ok: boolean; error?: string }> {
  return { ok: true };
}

export async function cityOptions(_args?: any): Promise<string[]> {
  return ["Kuwait", "Riyadh", "Dubai", "Jeddah", "Doha", "Abu Dhabi"];
}

export async function setAdvertisingCities(_args: {
  campaignName: string;
  cities: string[];
  taskId?: string;
  clientTag?: string;
}): Promise<{ ok: boolean; error?: string }> {
  return { ok: true };
}

export const api = {
  board: {
    adStatusOptions,
    setAdStatus,
    renameCard,
    addToBoard,
    dismissOffBoard,
    cityOptions,
    setAdvertisingCities,
  },
};

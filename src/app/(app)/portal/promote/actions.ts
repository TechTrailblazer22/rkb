"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireBuilderContext } from "@/lib/builders/context";
import { getDb } from "@/lib/db";
import { removeFeaturedDay, scheduleFeaturedDay } from "@/lib/featured/service";

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};

function back(message: { saved?: string; error?: string }): never {
  redirect(`/portal/promote?${new URLSearchParams(message as Record<string, string>).toString()}`);
}

async function context() {
  const ctx = await requireBuilderContext("/portal/promote");
  if (ctx.memberRole === "STAFF") redirect("/portal");
  return ctx;
}

export async function featureProject(formData: FormData) {
  const ctx = await context();
  const result = await scheduleFeaturedDay(getDb(), {
    builderId: ctx.builder.id,
    projectId: text(formData, "projectId"),
    day: text(formData, "day"),
    allowancePerMonth: ctx.entitlements.active ? ctx.entitlements.featuredDaysPerMonth : 0,
    actorId: ctx.user.id,
  });
  if (!result.ok) back({ error: result.message });
  revalidatePath("/portal/promote");
  back({ saved: "Featured day booked." });
}

export async function unfeatureProject(formData: FormData) {
  const ctx = await context();
  const ok = await removeFeaturedDay(getDb(), {
    builderId: ctx.builder.id,
    projectId: text(formData, "projectId"),
    day: text(formData, "day"),
    actorId: ctx.user.id,
  });
  revalidatePath("/portal/promote");
  back(
    ok
      ? { saved: "Featured day taken back. It counts as unused." }
      : { error: "Only a day that has not started can be taken back." },
  );
}

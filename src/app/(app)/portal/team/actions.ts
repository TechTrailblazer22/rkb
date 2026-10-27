"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireBuilderContext } from "@/lib/builders/context";
import { getDb } from "@/lib/db";
import { sendMail } from "@/lib/mail";
import { teamInviteMail } from "@/lib/mail/templates";
import {
  changeMemberRole,
  createInvite,
  removeMember,
  revokeInvite,
  roleLabel,
} from "@/lib/team/service";

// Only the owner manages the team. Every action finds the company from the logged-in user and the
// service only touches rows of that company.

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};

function back(message: { saved?: string; error?: string }): never {
  redirect(`/portal/team?${new URLSearchParams(message as Record<string, string>).toString()}`);
}

const owner = () => requireBuilderContext("/portal/team", { ownerOnly: true });

export async function inviteTeammate(formData: FormData) {
  const ctx = await owner();
  const result = await createInvite(getDb(), {
    builderId: ctx.builder.id,
    invitedById: ctx.user.id,
    email: text(formData, "email"),
    role: text(formData, "role"),
  });
  if (!result.ok) back({ error: result.message });

  let delivered = true;
  try {
    await sendMail({
      to: result.email,
      ...teamInviteMail({
        companyName: ctx.builder.companyName,
        invitedBy: ctx.user.name ?? ctx.user.email,
        role: roleLabel[result.role].toLowerCase(),
        token: result.token,
      }),
    });
  } catch (error) {
    console.error("Could not send a team invitation", error);
    delivered = false;
  }
  revalidatePath("/portal/team");
  back(
    delivered
      ? { saved: `Invitation sent to ${result.email}.` }
      : {
          error:
            "The invitation was created but the email could not be sent. Withdraw it and try again.",
        },
  );
}

export async function withdrawInvite(formData: FormData) {
  const ctx = await owner();
  const ok = await revokeInvite(getDb(), {
    builderId: ctx.builder.id,
    inviteId: text(formData, "inviteId"),
    actorId: ctx.user.id,
  });
  revalidatePath("/portal/team");
  back(ok ? { saved: "Invitation withdrawn." } : { error: "That invitation was not found." });
}

export async function removeTeammate(formData: FormData) {
  const ctx = await owner();
  const ok = await removeMember(getDb(), {
    builderId: ctx.builder.id,
    memberId: text(formData, "memberId"),
    actorId: ctx.user.id,
  });
  revalidatePath("/portal/team");
  back(ok ? { saved: "Removed from the team." } : { error: "That person was not found." });
}

export async function setTeammateRole(formData: FormData) {
  const ctx = await owner();
  const ok = await changeMemberRole(getDb(), {
    builderId: ctx.builder.id,
    memberId: text(formData, "memberId"),
    role: text(formData, "role"),
    actorId: ctx.user.id,
  });
  revalidatePath("/portal/team");
  back(ok ? { saved: "Role updated." } : { error: "That change could not be made." });
}

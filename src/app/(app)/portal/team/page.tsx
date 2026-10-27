import { Mail, Users } from "lucide-react";
import { UpgradeNotice } from "@/components/portal/upgrade-notice";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/field";
import { requireBuilderContext } from "@/lib/builders/context";
import { getDb } from "@/lib/db";
import { formatDate } from "@/lib/leads/format";
import { listTeam, roleLabel } from "@/lib/team/service";
import { inviteTeammate, removeTeammate, setTeammateRole, withdrawInvite } from "./actions";

export const metadata = { title: "Team" };

export default async function TeamPage({ searchParams }: PageProps<"/portal/team">) {
  const ctx = await requireBuilderContext("/portal/team", { ownerOnly: true });
  const { saved, error } = await searchParams;
  const { members, invites } = await listTeam(getDb(), ctx.builder.id);
  const seats = ctx.entitlements.teamSeats;
  const used = members.length + invites.length;
  const full = used >= seats;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold">Your team</h2>
        <p className="mt-1 text-sm text-slate-600">
          People you invite work on your projects, plots and leads. Billing, this team page, the
          company profile and your documents stay with you, the owner.
        </p>
      </div>

      {typeof saved === "string" && (
        <p
          role="status"
          className="rounded-lg bg-teal-50 px-4 py-3 text-sm font-medium text-teal-800"
        >
          {saved}
        </p>
      )}
      {typeof error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </p>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-base font-bold">
            <Users className="size-5 text-teal-700" aria-hidden="true" /> People
          </h3>
          <p className="text-sm text-slate-600" data-testid="seats">
            {used} of {seats} {seats === 1 ? "seat" : "seats"} used
          </p>
        </div>
        <ul className="mt-3 divide-y divide-slate-100" data-testid="members">
          {members.map((member) => (
            <li key={member.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{member.name ?? member.email}</p>
                <p className="text-sm text-slate-600">{member.email}</p>
              </div>
              {member.role === "OWNER" ? (
                <Badge tone="navy">Owner</Badge>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <form action={setTeammateRole} className="flex items-center gap-2">
                    <input type="hidden" name="memberId" value={member.id} />
                    <label>
                      <span className="sr-only">Role of {member.email}</span>
                      <select name="role" defaultValue={member.role} className={inputClass}>
                        <option value="MANAGER">Manager</option>
                        <option value="STAFF">Staff</option>
                      </select>
                    </label>
                    <button type="submit" className={buttonClass("secondary")}>
                      Save
                    </button>
                  </form>
                  <form action={removeTeammate}>
                    <input type="hidden" name="memberId" value={member.id} />
                    <button
                      type="submit"
                      className="rounded-lg border border-red-300 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
                    >
                      Remove
                    </button>
                  </form>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      {invites.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <h3 className="flex items-center gap-2 text-base font-bold">
            <Mail className="size-5 text-teal-700" aria-hidden="true" /> Waiting to join
          </h3>
          <ul className="mt-3 divide-y divide-slate-100" data-testid="invites">
            {invites.map((invite) => (
              <li key={invite.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{invite.email}</p>
                  <p className="text-sm text-slate-600">
                    {roleLabel[invite.role]} · link works until {formatDate(invite.expiresAt)}
                  </p>
                </div>
                <form action={withdrawInvite}>
                  <input type="hidden" name="inviteId" value={invite.id} />
                  <button type="submit" className={buttonClass("secondary")}>
                    Withdraw
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <h3 className="text-base font-bold">Invite someone</h3>
        {full ? (
          <UpgradeNotice
            className="mt-3"
            feature={seats === 1 ? "Teammates" : "More seats"}
            plan={seats === 1 ? "GROWTH" : "PREMIER"}
            lapsed={!ctx.entitlements.active}
          />
        ) : (
          <form action={inviteTeammate} className="mt-3 flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1 basis-60">
              <Field id="invite-email" label="Their email address">
                <input
                  id="invite-email"
                  name="email"
                  type="email"
                  required
                  maxLength={254}
                  autoComplete="off"
                  className={inputClass}
                />
              </Field>
            </div>
            <div>
              <Field id="invite-role" label="Role">
                <select id="invite-role" name="role" defaultValue="MANAGER" className={inputClass}>
                  <option value="MANAGER">Manager</option>
                  <option value="STAFF">Staff</option>
                </select>
              </Field>
            </div>
            <button type="submit" className={buttonClass("primary")}>
              Send invitation
            </button>
          </form>
        )}
        <p className="mt-3 text-xs text-slate-500">
          Manager: edits projects and plots, handles leads, and can submit, reopen or archive a
          project. Staff: edits projects and plots and handles leads, but cannot submit, reopen or
          archive. The link works for 7 days and only for that email address.
        </p>
      </section>
    </div>
  );
}

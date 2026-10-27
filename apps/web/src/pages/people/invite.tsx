import { Badge, Button, Dialog, DialogContent, Field, Select } from "@operant/ui";
import { useQuery } from "@tanstack/react-query";
import { MailPlus } from "lucide-react";
import { useState } from "react";
import { api } from "../../lib/api.ts";
import { type Employee, formatDate, PEOPLE_KEYS, useApiMutation } from "../../lib/people.ts";

/*
 * Inviting people to sign in. Operant asks Webrizen to email an invitation to their work
 * email; once they accept, they sign in with their Webrizen account and their profile here
 * links to them by that email.
 */


/** Whether someone can sign in, for lists and profiles. Nothing is shown once they can. */
export function SignInBadge({ e }: { e: Pick<Employee, "signIn" | "workEmail" | "status"> }) {
  if (e.status === "offboarded" || e.signIn === "active") return null;
  if (e.signIn === "invited") return <Badge tone="collab">Invited</Badge>;
  if (e.signIn === "expired") return <Badge tone="warning">Invite expired</Badge>;
  return e.workEmail ? <Badge>Not invited</Badge> : null;
}

export function InviteDialog({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ["invite-roles"],
    queryFn: () => api<{ roles: { id: string; name: string; isDefault: boolean }[]; available: boolean }>("employees/invite-roles"),
    staleTime: 60_000,
  });
  const [picked, setPicked] = useState<string | null>(null);
  // The default role comes first.
  const role = picked ?? data?.roles[0]?.id;
  const invite = useApiMutation(() => api(`employees/${employee.id}/invite`, { method: "POST", body: JSON.stringify(role ? { role } : {}) }), {
    invalidate: [...PEOPLE_KEYS, "employee"],
    success: `Invitation sent to ${employee.workEmail}`,
    onSuccess: onClose,
  });
  const again = employee.signIn === "invited" || employee.signIn === "expired";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={again ? `Send ${employee.fullName} a new invitation` : `Invite ${employee.fullName} to Operant`}
        icon={MailPlus}
        description={`Webrizen emails an invitation to ${employee.workEmail}. They accept it, set up their Webrizen account (email code, passkey or Google), and can then sign in to Operant. Their profile here links to them automatically.`}
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" disabled={invite.isPending || data?.available === false} onClick={() => invite.mutate(undefined)}>
              <MailPlus /> {invite.isPending ? "Sending…" : "Send invitation"}
            </Button>
          </>
        }
      >
        {data?.available === false ? (
          <p className="rounded-lg bg-secondary px-3 py-2 text-sm text-secondary">Invitations need Webrizen sign-in, which isn't set up for this installation.</p>
        ) : (
          <div className="space-y-4">
            <Field label="Role" hint="What they can do in Operant. You can change it any time under Settings → Roles & access.">
              <Select value={role ?? ""} onChange={(ev) => setPicked(ev.target.value)}>
                {(data?.roles ?? []).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </Field>
            {again && employee.invitedAt ? (
              <p className="text-xs text-tertiary">
                Last invited {formatDate(employee.invitedAt.slice(0, 10))}. The new invitation replaces it, and is valid for 7 days.
              </p>
            ) : (
              <p className="text-xs text-tertiary">The invitation is valid for 7 days. You can send a new one any time.</p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

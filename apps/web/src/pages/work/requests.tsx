import { can } from "@operant/core";
import { Avatar, Badge, Button, Card, DateInput, Dialog, DialogContent, EmptyState, Field, Input, Segmented, Select, Skeleton, Textarea } from "@operant/ui";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Ban, Copy, FileText, FolderKanban, Inbox, Mail, Phone, Rocket } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "../../components/app-shell.tsx";
import { ClientConversation, ReviewChecklist } from "../../components/client-conversation.tsx";
import { api, type Me } from "../../lib/api.ts";
import { useCrumb } from "../../lib/breadcrumbs.ts";
import { useMembers } from "../../lib/collab.ts";
import { money } from "../../lib/finance.ts";
import { formatDate, useApiMutation, useEmployees } from "../../lib/people.ts";
import { PORTAL_KEYS, REQUEST_STATUS, type RequestDetail, useProjectClient, useServiceRequest, useServiceRequests } from "../../lib/portal.ts";
import { WORK_KEYS } from "../../lib/work.ts";
import { WorkBody } from "./layout.tsx";

const ago = (iso: string) => {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return formatDate(iso.slice(0, 10), { day: "numeric", month: "short" });
};

/** The inbox of client requests from the portal. */
export function RequestsPage({ me }: { me: Me }) {
  const [status, setStatus] = useState("open");
  const { data } = useServiceRequests(status);
  const canManage = can(me.org.permissions, "settings", "manage");
  return (
    <WorkBody>
      <PageHeader
        title="Client requests"
        description="Services clients asked for in the client portal. Reply, quote, and start a project when you're ready."
        actions={
          canManage ? (
            <Button asChild>
              <Link to="/work/services">Manage services</Link>
            </Button>
          ) : null
        }
      />
      <Segmented
        aria-label="Status"
        value={status}
        onChange={setStatus}
        items={[
          { key: "open", label: "Open" },
          { key: "new", label: "New" },
          { key: "quoted", label: "Quoted" },
          { key: "closed", label: "Closed" },
          { key: "", label: "All" },
        ]}
      />
      {!data ? (
        <Skeleton className="h-64 w-full" />
      ) : data.requests.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Inbox />}
            title={status === "open" ? "No open requests" : "Nothing here"}
            description="When clients request a service in your portal, it shows up here."
            action={
              <Button asChild>
                <Link to="/work/services">Set up services</Link>
              </Button>
            }
          />
        </Card>
      ) : (
        <Card className="divide-y divide-border-secondary overflow-hidden p-0">
          {data.requests.map((r) => (
            <Link key={r.id} to="/work/requests/$id" params={{ id: r.id }} className="flex items-center gap-4 px-4 py-3.5 hover:bg-secondary sm:px-5">
              <Avatar name={r.clientName ?? r.contactEmail ?? "?"} className="size-10 rounded-lg" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-semibold text-primary">{r.title}</span>
                  <span className="font-mono text-xs text-quaternary">{r.label}</span>
                  {r.unread ? <Badge tone="brand">{r.unread} new</Badge> : null}
                  {r.docsWaiting ? (
                    <Badge tone="collab">
                      {r.docsWaiting} doc{r.docsWaiting === 1 ? "" : "s"} to review
                    </Badge>
                  ) : null}
                </div>
                <div className="truncate text-sm text-tertiary">
                  {r.clientName ?? r.contactEmail}
                  {r.contactName && r.contactName !== r.clientName ? ` · ${r.contactName}` : ""} · {ago(r.lastMessageAt ?? r.updatedAt)}
                </div>
              </div>
              {r.assignee ? <Avatar name={r.assignee.name} src={r.assignee.image} className="hidden size-7 sm:inline-flex" /> : null}
              <Badge tone={REQUEST_STATUS[r.status].tone} dot pill>
                {REQUEST_STATUS[r.status].label}
              </Badge>
            </Link>
          ))}
        </Card>
      )}
    </WorkBody>
  );
}

/** Start a project for the request: from the service's template, for the request's client. */
function StartProjectDialog({ detail, onClose }: { detail: RequestDetail; onClose: () => void }) {
  const navigate = useNavigate();
  const { data: people } = useEmployees();
  const [name, setName] = useState(`${detail.client?.name ?? "Client"}: ${detail.request.title}`.slice(0, 100));
  const [lead, setLead] = useState("");
  const [startDate, setStart] = useState(new Date().toISOString().slice(0, 10));
  const start = useApiMutation(
    async () => {
      const p = await api<{ project: { id: string } }>("projects", {
        method: "POST",
        body: JSON.stringify({
          name,
          clientId: detail.client?.id ?? null,
          leadEmployeeId: lead || null,
          startDate,
          ...(detail.service?.templateProjectId ? { templateProjectId: detail.service.templateProjectId } : {}),
        }),
      });
      await api(`service-requests/${detail.request.id}/project`, { method: "POST", body: JSON.stringify({ projectId: p.project.id }) });
      return p.project.id;
    },
    { invalidate: [...PORTAL_KEYS, ...WORK_KEYS], success: "Project started. The client can follow it in the portal.", onSuccess: (id) => navigate({ to: "/work/projects/$id", params: { id }, search: { view: "client" } }) },
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="Start a project"
        icon={Rocket}
        description={detail.service?.templateProjectId ? "Stages, milestones and tasks are copied from the service's template." : "Add a template to the service to start with its tasks next time."}
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!name.trim() || start.isPending} onClick={() => start.mutate(undefined)}>
              Start project
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Project name" className="sm:col-span-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus />
          </Field>
          <Field label="Lead" hint="The client sees the team's names and photos.">
            <Select value={lead} onChange={(e) => setLead(e.target.value)}>
              <option value="">No lead</option>
              {people?.employees.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.fullName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Start date">
            <DateInput value={startDate} onChange={setStart} />
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ServiceRequestPage({ me }: { me: Me }) {
  const { id } = useParams({ strict: false }) as { id: string };
  const navigate = useNavigate();
  const { data, error } = useServiceRequest(id);
  const { data: members } = useMembers();
  const [starting, setStarting] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  useCrumb(data ? data.request.label : null);
  const p = me.org.permissions;
  const canHandle = can(p, "client", "update") || can(p, "project", "create");

  const update = useApiMutation((body: Record<string, unknown>) => api(`service-requests/${id}`, { method: "PATCH", body: JSON.stringify(body) }), { invalidate: PORTAL_KEYS });
  const quote = useApiMutation(() => api<{ quote: { id: string } }>(`service-requests/${id}/quote`, { method: "POST" }), {
    invalidate: [...PORTAL_KEYS, "finance-docs"],
    onSuccess: (r) => navigate({ to: "/finance/invoices/$id", params: { id: r.quote.id } }),
  });

  if (error) return <WorkBody>{error.message}</WorkBody>;
  if (!data) {
    return (
      <WorkBody>
        <Skeleton className="h-[600px] w-full" />
      </WorkBody>
    );
  }
  const r = data.request;
  const closed = r.status === "declined" || r.status === "withdrawn";
  const clientName = data.client?.name ?? data.contact?.name ?? "the client";

  return (
    <WorkBody>
      <Link to="/work/requests" className="inline-flex items-center gap-1 text-sm text-tertiary hover:text-primary">
        <ArrowLeft className="size-4" /> Client requests
      </Link>
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-display-xs font-semibold">{r.title}</h1>
            <Badge tone={REQUEST_STATUS[r.status].tone} dot pill>
              {REQUEST_STATUS[r.status].label}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-tertiary">
            <span className="font-mono">{r.label}</span> · from {clientName} · {formatDate(r.createdAt.slice(0, 10))}
          </p>
        </div>
        {canHandle && !closed && !data.project ? (
          <div className="flex flex-wrap gap-2">
            {can(p, "invoice", "create") ? (
              <Button onClick={() => (data.quote ? navigate({ to: "/finance/invoices/$id", params: { id: data.quote.id } }) : quote.mutate(undefined))} disabled={quote.isPending || !data.client}>
                <FileText /> {data.quote ? "Open quote" : "Prepare a quote"}
              </Button>
            ) : null}
            {can(p, "project", "create") ? (
              <Button variant="primary" onClick={() => setStarting(true)}>
                <Rocket /> Start project
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {data.project ? (
        <Link to="/work/projects/$id" params={{ id: data.project.id }} search={{ view: "client" }} className="flex items-center gap-3 rounded-xl border border-secondary bg-primary p-4 shadow-xs hover:bg-secondary">
          <FolderKanban className="size-5 text-work" />
          <span className="flex-1 text-sm">
            Project <span className="font-semibold">{data.project.name}</span> is under way. The conversation and documents continue on its Client tab.
          </span>
          <ArrowRight className="size-4 text-quaternary" />
        </Link>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="mb-2 font-semibold">What they asked</h2>
            <p className="whitespace-pre-wrap text-sm text-secondary">{r.details || "No details given."}</p>
            {data.service ? (
              <p className="mt-3 text-xs text-tertiary">
                Service: <span className="font-medium text-secondary">{data.service.name}</span> · {data.service.priceLabel}
              </p>
            ) : null}
          </Card>

          <Card className="overflow-hidden p-0">
            <div className="flex items-center gap-2 border-b border-secondary bg-brand-primary px-5 py-3">
              <Mail className="size-4 text-brand-secondary" />
              <span className="text-sm font-semibold text-brand-secondary">Conversation with {clientName}</span>
              <span className="ml-auto text-xs text-tertiary">Visible to the client</span>
            </div>
            <div className="p-5">
              <ClientConversation
                messages={data.messages}
                postPath={`service-requests/${id}/messages`}
                clientName={clientName}
                canReply={canHandle}
                closedNote={data.project ? "This continues on the project's Client tab." : closed ? "This request is closed." : undefined}
              />
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="mb-3 font-semibold">Client</h2>
            <div className="text-sm">
              {data.client ? (
                <Link to="/finance/clients/$id" params={{ id: data.client.id }} className="font-semibold text-primary hover:underline">
                  {data.client.name}
                </Link>
              ) : null}
              {data.contact ? (
                <div className="mt-2 space-y-1 text-tertiary">
                  <div>{data.contact.name}</div>
                  <a href={`mailto:${data.contact.email}`} className="flex items-center gap-1.5 hover:text-secondary">
                    <Mail className="size-3.5" /> {data.contact.email}
                  </a>
                  {data.contact.phone ? (
                    <a href={`tel:${data.contact.phone}`} className="flex items-center gap-1.5 hover:text-secondary">
                      <Phone className="size-3.5" /> {data.contact.phone}
                    </a>
                  ) : null}
                </div>
              ) : null}
              {data.client && !data.client.billingAddress ? <p className="mt-3 text-xs text-tertiary">Billing details aren't in yet. The client is asked for them when they accept a quote.</p> : null}
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 font-semibold">Handled by</h2>
            <Select value={r.assigneeUserId ?? ""} onChange={(e) => update.mutate({ assigneeUserId: e.target.value || null })} disabled={!canHandle}>
              <option value="">Nobody yet</option>
              {members?.members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </Select>
            <p className="mt-2 text-xs text-tertiary">The client sees this person's name and photo.</p>
          </Card>

          {data.quote ? (
            <Card className="p-5">
              <h2 className="mb-2 font-semibold">Quote</h2>
              <Link to="/finance/invoices/$id" params={{ id: data.quote.id }} className="flex items-center justify-between text-sm hover:underline">
                <span className="font-mono">{data.quote.number ?? "Draft"}</span>
                <span className="font-mono">{money(data.quote.total, data.quote.currency)}</span>
              </Link>
              <p className="mt-1 text-xs text-tertiary">
                {
                  {
                    draft: "Issue it to send it to the client's portal.",
                    sent: "Waiting for the client.",
                    accepted: "The client accepted it. Record their advance against it.",
                    partially_paid: "Part paid. Each payment gets a receipt.",
                    paid: "Paid in full. Generate the final invoice from the quote.",
                    declined: "The client declined it.",
                    void: "Void.",
                  }[data.quote.status] ?? ""
                }
              </p>
            </Card>
          ) : null}

          <Card className="p-5">
            <h2 className="mb-3 font-semibold">Documents</h2>
            <ReviewChecklist items={data.documents} addPath={`service-requests/${id}/documents`} canEdit={canHandle && !closed} />
          </Card>

          {canHandle && !closed && !data.project ? (
            declining ? (
              <Card className="space-y-3 p-5">
                <Field label="Why can't you take it on?" hint="The client sees this.">
                  <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={1000} />
                </Field>
                <div className="flex gap-2">
                  <Button variant="danger" onClick={() => update.mutate({ status: "declined", declineReason: reason || null })}>
                    Decline request
                  </Button>
                  <Button variant="ghost" onClick={() => setDeclining(false)}>
                    Cancel
                  </Button>
                </div>
              </Card>
            ) : (
              <Button variant="ghost" className="w-full text-error-primary" onClick={() => setDeclining(true)}>
                <Ban /> Decline
              </Button>
            )
          ) : null}
        </div>
      </div>
      {starting ? <StartProjectDialog detail={data} onClose={() => setStarting(false)} /> : null}
    </WorkBody>
  );
}


/** A project's Client tab: the conversation and documents shared with the client in the portal. */
export function ProjectClientTab({ me, projectId, clientName }: { me: Me; projectId: string; clientName: string }) {
  const { data } = useProjectClient(projectId, true);
  const p = me.org.permissions;
  const canHandle = can(p, "client", "update") || can(p, "project", "create");
  if (!data) return <Skeleton className="h-96 w-full" />;
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <Card className="overflow-hidden p-0">
        <div className="flex items-center gap-2 border-b border-secondary bg-brand-primary px-5 py-3">
          <Mail className="size-4 text-brand-secondary" />
          <span className="text-sm font-semibold text-brand-secondary">Conversation with {clientName}</span>
          <span className="ml-auto text-xs text-tertiary">Visible to the client</span>
        </div>
        <div className="p-5">
          <ClientConversation messages={data.messages} postPath={`projects/${projectId}/client-messages`} clientName={clientName} canReply={canHandle} />
        </div>
      </Card>
      <div className="space-y-6">
        <Card className="p-5">
          <h2 className="mb-3 font-semibold">Documents</h2>
          <ReviewChecklist items={data.documents} addPath={`projects/${projectId}/client-documents`} canEdit={canHandle} />
        </Card>
        <Card className="p-5">
          <h2 className="mb-2 font-semibold">In the portal</h2>
          {data.portalPeople.length ? (
            <ul className="space-y-1 text-sm">
              {data.portalPeople.map((u) => (
                <li key={u.email} className="flex justify-between gap-2">
                  <span className="truncate">{u.name ?? u.email}</span>
                  <span className="shrink-0 text-xs text-tertiary">{u.lastSignInAt ? `seen ${ago(u.lastSignInAt)}` : "invited"}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-tertiary">Nobody from {clientName} has signed in yet. Share the link: they sign in with their email.</p>
          )}
          <Button size="sm" className="mt-3" onClick={() => (void navigator.clipboard?.writeText(data.portalUrl), toast.success("Portal link copied"))}>
            <Copy /> Copy portal link
          </Button>
          {data.request ? (
            <Link to="/work/requests/$id" params={{ id: data.request.id }} className="mt-3 block text-xs text-tertiary hover:text-secondary">
              Started from request {data.request.label}
            </Link>
          ) : null}
        </Card>
      </div>
    </div>
  );
}

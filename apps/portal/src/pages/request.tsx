import { Avatar, Badge, Button, cn, Skeleton } from "@operant/ui";
import { Link, useParams } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Check, ExternalLink } from "lucide-react";
import { Checklist, Conversation } from "../components/conversation.tsx";
import { PageTitle, Section, SignedIn, useSlug } from "../components/shell.tsx";
import { QuoteAnswer } from "../components/quote-answer.tsx";
import { api, longDate, money, type RequestDetail, STATUS, useAction, useRequest } from "../lib/api.ts";

const STEPS = ["Requested", "Discussing", "Quote", "Work starts"] as const;
const stepOf = (s: RequestDetail["request"]["status"]) => ({ new: 0, in_discussion: 1, quoted: 2, accepted: 3, started: 3, declined: 1, withdrawn: 0 })[s];

export function RequestPage() {
  return (
    <SignedIn>
      <RequestView />
    </SignedIn>
  );
}

function RequestView() {
  const slug = useSlug();
  const { id } = useParams({ strict: false }) as { id: string };
  const { data, error } = useRequest(slug, id);
  const withdraw = useAction(() => api(`portal/orgs/${slug}/requests/${id}/withdraw`, { method: "POST" }), { success: "Request withdrawn" });

  if (error) return <p className="text-sm text-tertiary">{error.message}</p>;
  if (!data) return <Skeleton className="h-[600px] rounded-2xl" />;
  const r = data.request;
  const closed = r.status === "declined" || r.status === "withdrawn";
  const step = stepOf(r.status);

  return (
    <div>
      <PageTitle
        back={
          <Link to="/$slug" params={{ slug }} className="mb-3 inline-flex items-center gap-1 text-sm text-tertiary hover:text-secondary">
            <ArrowLeft className="size-4" /> Home
          </Link>
        }
        title={r.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm">{r.label}</span>· sent {longDate(r.createdAt)}
            <Badge tone={STATUS[r.status].tone} pill>
              {STATUS[r.status].label}
            </Badge>
          </span>
        }
      />

      {r.project ? (
        <Link to="/$slug/projects/$id" params={{ slug, id: r.project.id }} className="mb-6 flex items-center gap-3 rounded-2xl border border-brand bg-brand-primary p-4 hover:opacity-90">
          <span className="flex-1 text-sm">
            <span className="font-semibold text-primary">Work has started.</span> <span className="text-secondary">Follow it on the project {r.project.name}.</span>
          </span>
          <ArrowRight className="size-5 text-brand-secondary" />
        </Link>
      ) : null}

      {!closed ? (
        <ol className="mb-6 grid grid-cols-4 gap-2">
          {STEPS.map((s, i) => (
            <li key={s} className="flex flex-col gap-2">
              <span className={cn("h-1.5 rounded-full", i <= step ? "bg-brand-solid" : "bg-tertiary")} />
              <span className={cn("flex items-center gap-1 text-xs", i <= step ? "font-semibold text-primary" : "text-tertiary")}>
                {i < step ? <Check className="size-3.5" /> : null}
                {s}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mb-6 rounded-xl bg-primary p-4 text-sm text-secondary ring-1 ring-secondary">
          {r.status === "declined" ? `The team can't take this on.${r.declineReason ? ` ${r.declineReason}` : ""}` : "You withdrew this request."}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {r.quote ? (
            <Section title={`Quote ${r.quote.number}`} action={<Badge tone={r.quote.status === "accepted" ? "people" : r.quote.status === "declined" ? "danger" : "brand"} pill>{r.quote.status === "sent" ? "Waiting for you" : r.quote.status}</Badge>}>
              <div className="flex flex-wrap items-end gap-4">
                <div className="flex-1">
                  <div className="font-mono text-display-xs font-semibold">{money(r.quote.total, r.quote.currency)}</div>
                  {r.quote.validUntil ? <div className="text-sm text-tertiary">Valid until {longDate(r.quote.validUntil)}</div> : null}
                </div>
                <Button asChild>
                  <a href={r.quote.url} target="_blank" rel="noreferrer">
                    View quote <ExternalLink />
                  </a>
                </Button>
              </div>
              {r.quote.status === "sent" || r.quote.counterOffer ? (
                <div className="mt-5 border-t border-secondary pt-5">
                  <QuoteAnswer slug={slug} quote={r.quote} />
                </div>
              ) : null}
            </Section>
          ) : null}

          <Section title="Conversation">
            <Conversation
              slug={slug}
              messages={data.messages}
              postPath={`portal/orgs/${slug}/requests/${id}/messages`}
              disabled={r.project ? "This conversation continues on the project." : closed ? "This request is closed." : undefined}
            />
          </Section>
        </div>

        <div className="space-y-6">
          {r.handler ? (
            <Section title="Looking after you">
              <div className="flex items-center gap-3">
                <Avatar name={r.handler.name} src={r.handler.image} className="size-12" />
                <div>
                  <div className="font-semibold text-primary">{r.handler.name}</div>
                  {r.handler.jobTitle ? <div className="text-sm text-tertiary">{r.handler.jobTitle}</div> : null}
                </div>
              </div>
            </Section>
          ) : null}

          {!r.project ? (
            <Section title="Documents">
              <Checklist slug={slug} items={data.documents} />
            </Section>
          ) : null}

          <Section title="Your request">
            {r.service ? (
              <div className="mb-3 text-sm">
                <span className="font-medium text-primary">{r.service.name}</span>
                <span className="text-tertiary"> · {r.service.priceLabel}</span>
              </div>
            ) : null}
            <p className="whitespace-pre-wrap text-sm text-secondary">{r.details || "No details added."}</p>
            {["new", "in_discussion", "quoted"].includes(r.status) ? (
              <Button size="sm" variant="ghost" className="mt-4 text-error-primary" onClick={() => confirm("Withdraw this request?") && withdraw.mutate(undefined)}>
                Withdraw request
              </Button>
            ) : null}
          </Section>
        </div>
      </div>
    </div>
  );
}

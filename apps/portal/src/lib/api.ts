import { formatMoney } from "@operant/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly issues?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set("content-type", "application/json");
  const res = await fetch(`/api/v1/${path}`, { ...init, headers, credentials: "same-origin" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string; issues?: { path: string; message: string }[] };
    throw new ApiError(res.status, body.issues?.[0]?.message ?? body.error ?? `Request failed (${res.status})`, body.code, body.issues);
  }
  return (await res.json()) as T;
}

export const money = (paise: number, currency = "INR") => formatMoney(paise, currency);

export const longDate = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "";

export const when = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay ? d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

/* ---------------- Types ---------------- */

export interface DirectoryOrg {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  tagline: string | null;
  services: number;
  categories: string[];
  names: string[];
}

export interface Service {
  id: string;
  name: string;
  summary: string | null;
  description: string | null;
  category: string | null;
  priceType: "fixed" | "from" | "quote";
  price: number | null;
  billing: "one_time" | "monthly" | "quarterly" | "yearly";
  priceLabel: string;
  deliveryDays: number | null;
  requiredDocs: { name: string; hint?: string | null }[];
}

export interface OrgPage {
  org: { name: string; slug: string; logo: string | null; tagline: string | null; legalName: string | null; email: string | null; phone: string | null; address: string | null };
  services: Service[];
}

export interface Me {
  user: { email: string; name: string | null; phone: string | null };
  company: { name: string; legalName: string | null; gstin: string | null; billingAddress: string | null; stateCode: string | null; country: string; billingComplete: boolean } | null;
}

export type RequestStatus = "new" | "in_discussion" | "quoted" | "accepted" | "started" | "declined" | "withdrawn";

export interface Person {
  name: string;
  image: string | null;
  jobTitle: string | null;
}

export interface FileRef {
  id: string;
  name: string;
  contentType: string;
  size: number;
  createdAt: string;
}

export interface Message {
  id: string;
  authorKind: "client" | "staff" | "system";
  body: string;
  createdAt: string;
  seenByStaffAt: string | null;
  author: Person | null;
  files: FileRef[];
}

export interface ChecklistItem {
  id: string;
  name: string;
  hint: string | null;
  status: "requested" | "uploaded" | "accepted" | "rejected";
  note: string | null;
  files: FileRef[];
}

export interface Home {
  attention: { kind: "quote" | "documents" | "message" | "invoice"; title: string; detail?: string; path: string }[];
  requests: { id: string; label: string; title: string; status: RequestStatus; projectId: string | null; updatedAt: string; unread: number; docsNeeded: number }[];
  projects: { id: string; name: string; status: string; dueDate: string | null; done: number; total: number; unread: number; docsNeeded: number }[];
  due: { count: number; amount: number; currency: string };
}

export interface RequestDetail {
  request: {
    id: string;
    label: string;
    title: string;
    details: string | null;
    status: RequestStatus;
    declineReason: string | null;
    createdAt: string;
    service: { name: string; priceLabel: string; deliveryDays: number | null } | null;
    handler: Person | null;
    quote: { id: string; number: string; status: string; total: number; currency: string; validUntil: string | null; url: string; counterOffer: CounterOffer | null } | null;
    project: { id: string; name: string } | null;
  };
  messages: Message[];
  documents: ChecklistItem[];
}

export interface ProjectDetail {
  project: { id: string; name: string; description: string | null; status: string; startDate: string | null; dueDate: string | null; done: number; total: number };
  milestones: { id: string; name: string; dueDate: string | null; completedAt: string | null }[];
  team: (Person & { lead: boolean })[];
  messages: Message[];
  documents: ChecklistItem[];
}

/** The client's latest proposed price for a quote. */
export interface CounterOffer {
  amount: number;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  response: string | null;
  createdAt: string;
}

export interface BillingDoc {
  id: string;
  kind: "invoice" | "quote" | "credit_note";
  number: string;
  status: string;
  issueDate: string;
  dueDate: string | null;
  total: number;
  amountPaid: number;
  currency: string;
  url: string;
  counterOffer: CounterOffer | null;
}

/* ---------------- Queries ---------------- */

export const useDirectory = (q: string) => useQuery({ queryKey: ["directory", q], queryFn: () => api<{ orgs: DirectoryOrg[] }>(`portal/orgs${q ? `?q=${encodeURIComponent(q)}` : ""}`) });
export const useOrgPage = (slug: string) => useQuery({ queryKey: ["org", slug], queryFn: () => api<OrgPage>(`portal/orgs/${slug}`), retry: false, staleTime: 60_000 });

/** The signed-in client, or null when signed out. */
export const useMe = (slug: string) =>
  useQuery({
    queryKey: ["me", slug],
    queryFn: async () => {
      try {
        return await api<Me>(`portal/orgs/${slug}/me`);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
  });

const live = { refetchInterval: 15_000 };
export const useHome = (slug: string) => useQuery({ queryKey: ["home", slug], queryFn: () => api<Home>(`portal/orgs/${slug}/home`), ...live });
export const useRequest = (slug: string, id: string) => useQuery({ queryKey: ["request", slug, id], queryFn: () => api<RequestDetail>(`portal/orgs/${slug}/requests/${id}`), ...live });
export const useProject = (slug: string, id: string) => useQuery({ queryKey: ["project", slug, id], queryFn: () => api<ProjectDetail>(`portal/orgs/${slug}/projects/${id}`), ...live });
export const useDocuments = (slug: string) =>
  useQuery({
    queryKey: ["documents", slug],
    queryFn: () =>
      api<{ groups: { kind: "project" | "request"; id: string; title: string; documents: ChecklistItem[]; shared: (FileRef & { from: "client" | "staff" | "system" })[] }[] }>(`portal/orgs/${slug}/documents`),
  });
export const useBilling = (slug: string) => useQuery({ queryKey: ["billing", slug], queryFn: () => api<{ documents: BillingDoc[] }>(`portal/orgs/${slug}/invoices`) });

/** A mutation that shows errors as toasts and refreshes everything for this org afterwards. */
export function useAction<V, R = unknown>(fn: (v: V) => Promise<R>, opts: { success?: string; onSuccess?: (r: R) => void; onError?: (e: Error) => boolean | void } = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (r) => {
      if (opts.success) toast.success(opts.success);
      opts.onSuccess?.(r);
      await qc.invalidateQueries();
    },
    onError: (e: Error) => {
      if (opts.onError?.(e)) return;
      toast.error(e.message);
    },
  });
}

export async function uploadFile(slug: string, file: File, ownerType: "portal_message" | "client_document", ownerId: string) {
  const form = new FormData();
  form.set("file", file);
  form.set("ownerType", ownerType);
  form.set("ownerId", ownerId);
  return api<{ attachment: FileRef }>(`portal/orgs/${slug}/files`, { method: "POST", body: form });
}

export const fileUrl = (slug: string, id: string) => `/api/v1/portal/orgs/${slug}/files/${id}`;

export const STATUS: Record<RequestStatus, { label: string; tone: "neutral" | "collab" | "finance" | "people" | "danger" | "brand" }> = {
  new: { label: "Sent", tone: "collab" },
  in_discussion: { label: "In discussion", tone: "collab" },
  quoted: { label: "Quote ready", tone: "brand" },
  accepted: { label: "Accepted", tone: "people" },
  started: { label: "In progress", tone: "people" },
  declined: { label: "Declined", tone: "danger" },
  withdrawn: { label: "Withdrawn", tone: "neutral" },
};


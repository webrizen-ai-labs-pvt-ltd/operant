import { Button, Logo } from "@operant/ui";
import { createRootRoute, createRoute, createRouter, Link } from "@tanstack/react-router";
import { MeContext, useViewer } from "./lib/viewer.ts";
import { AppShell } from "./components/app-shell.tsx";
import { ApiError, signIn, signOut, useMe } from "./lib/api.ts";
import { ChannelPage, CollabIndexPage, DecisionsPage, MentionsPage } from "./pages/collab/channel.tsx";
import { CollabLayout } from "./pages/collab/layout.tsx";
import { ClientPage, ClientsPage } from "./pages/finance/clients.tsx";
import { DocumentPage, DocumentsPage, NewDocumentPage } from "./pages/finance/documents.tsx";
import { FinanceLayout } from "./pages/finance/layout.tsx";
import { FinanceSettingsPage, PaymentsPage, RetainersPage } from "./pages/finance/more.tsx";
import { FinanceOverviewPage } from "./pages/finance/overview.tsx";
import { ReceiptPage } from "./pages/finance/receipt.tsx";
import { HomePage } from "./pages/home.tsx";
import { DirectoryPage } from "./pages/people/directory.tsx";
import { PeopleLayout } from "./pages/people/layout.tsx";
import { LeavePage } from "./pages/people/leave.tsx";
import { OnboardingPage } from "./pages/people/onboarding.tsx";
import { OrgChartPage } from "./pages/people/org-chart.tsx";
import { PeopleOverviewPage } from "./pages/people/overview.tsx";
import { ProfilePage } from "./pages/people/profile.tsx";
import { StructurePage } from "./pages/people/structure.tsx";
import { GoalsPage } from "./pages/work/goals.tsx";
import { WorkLayout } from "./pages/work/layout.tsx";
import { MyWorkPage } from "./pages/work/my-work.tsx";
import { ProjectPage } from "./pages/work/project.tsx";
import { ProjectsPage } from "./pages/work/projects.tsx";
import { RequestsPage, ServiceRequestPage } from "./pages/work/requests.tsx";
import { ServicesPage } from "./pages/work/services.tsx";
import { WorkloadPage } from "./pages/work/workload.tsx";
import { AuditPage, OrgSettingsPage, PreferencesPage } from "./pages/settings.tsx";
import { SignInPage } from "./pages/sign-in.tsx";

export { useViewer };

function Splash() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <Logo className="size-10 animate-pulse text-brand-secondary" />
    </div>
  );
}

function NoOrganization({ reason }: { reason: string }) {
  const removed = /no longer have access/i.test(reason);
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <Logo className="mx-auto size-10 text-primary" />
        <h1 className="mt-6 text-2xl font-bold">{removed ? "You no longer have access" : "Join an organization"}</h1>
        <p className="mt-2 text-sm text-tertiary">
          {removed
            ? "An admin removed you from this organization in Webrizen. Ask them to add you back, or sign in to another organization."
            : "Operant works inside an organization. Create one in your Webrizen account, or ask your admin for an invite."}
        </p>
        <p className="mt-3 font-mono text-xs text-quaternary">{reason}</p>
        <div className="mt-6 flex flex-col gap-2">
          <Button variant="primary" onClick={() => signIn("/")}>
            Choose an organization
          </Button>
          <Button variant="ghost" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}

function Root() {
  const { data: me, error, isLoading } = useMe();
  if (isLoading) return <Splash />;
  if (error instanceof ApiError && error.status === 401) return <SignInPage />;
  if (error instanceof ApiError && error.status === 403) return <NoOrganization reason={error.message} />;
  if (error || !me) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6 text-center">
        <div>
          <h1 className="text-2xl font-bold">We can't reach Operant</h1>
          <p className="mt-2 text-sm text-tertiary">Check your connection, then try again.</p>
          <Button className="mt-6" onClick={() => window.location.reload()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }
  return (
    <MeContext value={me}>
      <AppShell me={me} />
    </MeContext>
  );
}

const rootRoute = createRootRoute({
  component: Root,
  notFoundComponent: () => (
    <div className="p-8">
      <h1 className="text-2xl font-bold">Page not found</h1>
      <Link to="/" className="mt-2 inline-block text-sm text-brand-secondary hover:underline">
        Go home
      </Link>
    </div>
  ),
});

const page = <P extends string>(path: P, Component: () => React.ReactNode) =>
  createRoute({ getParentRoute: () => rootRoute, path, component: Component });

const peopleRoute = createRoute({ getParentRoute: () => rootRoute, path: "/people", component: PeopleLayout });
const peoplePage = <P extends string>(path: P, Component: () => React.ReactNode, validateSearch?: (s: Record<string, unknown>) => object) =>
  createRoute({ getParentRoute: () => peopleRoute, path, component: Component, ...(validateSearch ? { validateSearch } : {}) });

/** Every Work page accepts ?task=<id> to open a task in the side panel. */
const taskSearch = (s: Record<string, unknown>): { task?: string } => (typeof s.task === "string" ? { task: s.task } : {});
const workRoute = createRoute({ getParentRoute: () => rootRoute, path: "/work", component: WorkLayout, validateSearch: taskSearch });
const workPage = <P extends string>(path: P, Component: () => React.ReactNode, validateSearch?: (s: Record<string, unknown>) => { view?: string }) =>
  createRoute({
    getParentRoute: () => workRoute,
    path,
    component: Component,
    validateSearch: (s: Record<string, unknown>): { task?: string; view?: string } => ({ ...taskSearch(s), ...(validateSearch ? validateSearch(s) : {}) }),
  });

const collabRoute = createRoute({ getParentRoute: () => rootRoute, path: "/collab", component: () => <CollabLayout me={useViewer()} /> });
const collabPage = <P extends string>(path: P, Component: () => React.ReactNode) =>
  createRoute({ getParentRoute: () => collabRoute, path, component: Component });

const financeRoute = createRoute({ getParentRoute: () => rootRoute, path: "/finance", component: FinanceLayout });
const financePage = <P extends string>(
  path: P,
  Component: () => React.ReactNode,
  validateSearch?: (s: Record<string, unknown>) => { kind?: "invoice" | "quote"; clientId?: string; projectId?: string },
) => createRoute({ getParentRoute: () => financeRoute, path, component: Component, ...(validateSearch ? { validateSearch } : {}) });

const routeTree = rootRoute.addChildren([
  page("/", () => <HomePage me={useViewer()} />),
  peopleRoute.addChildren([
    peoplePage("/", () => <PeopleOverviewPage />),
    peoplePage("directory", () => <DirectoryPage me={useViewer()} />, (s) => ({ add: s.add === true || s.add === "true" ? true : undefined })),
    peoplePage("org-chart", () => <OrgChartPage />),
    peoplePage("structure", () => <StructurePage me={useViewer()} />),
    peoplePage("leave", () => <LeavePage me={useViewer()} />, (s) => ({ tab: typeof s.tab === "string" ? s.tab : undefined })),
    peoplePage("onboarding", () => <OnboardingPage me={useViewer()} />),
    peoplePage("$id", () => <ProfilePage />),
  ]),
  workRoute.addChildren([
    workPage("/", () => <MyWorkPage />),
    workPage("projects", () => <ProjectsPage me={useViewer()} />),
    workPage("projects/$id", () => <ProjectPage me={useViewer()} />, (s) => (typeof s.view === "string" ? { view: s.view } : {})),
    workPage("requests", () => <RequestsPage me={useViewer()} />),
    workPage("requests/$id", () => <ServiceRequestPage me={useViewer()} />),
    workPage("services", () => <ServicesPage me={useViewer()} />),
    workPage("goals", () => <GoalsPage me={useViewer()} />),
    workPage("workload", () => <WorkloadPage />),
  ]),
  collabRoute.addChildren([
    collabPage("/", () => <CollabIndexPage />),
    collabPage("c/$id", () => <ChannelPage me={useViewer()} />),
    collabPage("mentions", () => <MentionsPage />),
    collabPage("decisions", () => <DecisionsPage />),
  ]),
  financeRoute.addChildren([
    financePage("/", () => <FinanceOverviewPage me={useViewer()} />),
    financePage("invoices", () => <DocumentsPage me={useViewer()} kind="invoice" />),
    financePage("quotes", () => <DocumentsPage me={useViewer()} kind="quote" />),
    financePage("new", () => <NewDocumentPage me={useViewer()} />, (s) => ({
      ...(s.kind === "quote" || s.kind === "invoice" ? { kind: s.kind } : {}),
      ...(typeof s.clientId === "string" ? { clientId: s.clientId } : {}),
      ...(typeof s.projectId === "string" ? { projectId: s.projectId } : {}),
    })),
    financePage("invoices/$id", () => <DocumentPage me={useViewer()} />),
    financePage("receipts/$id", () => <ReceiptPage />),
    financePage("clients", () => <ClientsPage me={useViewer()} />),
    financePage("clients/$id", () => <ClientPage me={useViewer()} />),
    financePage("payments", () => <PaymentsPage />),
    financePage("retainers", () => <RetainersPage me={useViewer()} />),
    financePage("settings", () => <FinanceSettingsPage me={useViewer()} />),
  ]),
  page("/settings", () => <OrgSettingsPage me={useViewer()} />),
  page("/settings/audit", () => <AuditPage me={useViewer()} />),
  page("/settings/preferences", () => <PreferencesPage />),
]);

export const router = createRouter({ routeTree, defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

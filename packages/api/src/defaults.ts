import { type Db, holidays, labels, leaveTypes, type OnboardingTemplateItem, onboardingTemplates } from "@operant/db";
import { ensureOrgRoles } from "./roles.ts";

/** Starting data for a brand-new organization. Everything is editable afterwards. */
export async function seedOrgDefaults(db: Db, orgId: string, now = new Date()) {
  await ensureOrgRoles(db, orgId);

  await db.insert(leaveTypes).values([
    { orgId, name: "Casual leave", color: "#2e8b6e", annualQuota: 12, paid: true },
    { orgId, name: "Sick leave", color: "#4c6e9e", annualQuota: 8, paid: true },
    { orgId, name: "Earned leave", color: "#c8a24a", annualQuota: 15, paid: true },
    { orgId, name: "Unpaid leave", color: "#8a8178", annualQuota: null, paid: false },
  ]);

  // National holidays with fixed dates; festivals vary by year and region, so admins add those.
  const year = now.getUTCFullYear();
  await db
    .insert(holidays)
    .values(
      [year, year + 1].flatMap((y) => [
        { orgId, name: "Republic Day", date: `${y}-01-26` },
        { orgId, name: "Independence Day", date: `${y}-08-15` },
        { orgId, name: "Gandhi Jayanti", date: `${y}-10-02` },
      ]),
    )
    .onConflictDoNothing();

  const items: OnboardingTemplateItem[] = [
    { title: "Share offer letter and joining documents", assignee: "manager", dueOffsetDays: -3 },
    { title: "Set up laptop, email and tool access", assignee: "manager", dueOffsetDays: 0 },
    { title: "Complete your profile and upload ID documents", assignee: "employee", dueOffsetDays: 1 },
    { title: "Read the company handbook and policies", assignee: "employee", dueOffsetDays: 3 },
    { title: "Meet the team and your buddy", assignee: "employee", dueOffsetDays: 2 },
    { title: "Agree on 30-60-90 day goals", assignee: "manager", dueOffsetDays: 7 },
    { title: "First month check-in", assignee: "manager", dueOffsetDays: 30 },
  ];
  await db.insert(onboardingTemplates).values({
    orgId,
    name: "Standard onboarding",
    description: "A starting checklist for every new joiner.",
    items,
  });

  await db.insert(labels).values([
    { orgId, name: "Client request", color: "#c8a24a" },
    { orgId, name: "Bug", color: "#d7263d" },
    { orgId, name: "Improvement", color: "#4c6e9e" },
    { orgId, name: "Internal", color: "#8a8178" },
  ]);
}

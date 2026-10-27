import type { PermissionSet } from "./permissions.ts";

/** The signed-in person as seen by the API, regardless of edition. */
export interface Viewer {
  userId: string;
  email: string;
  name: string;
  image: string | null;
  org: ViewerOrg | null;
  /** Cloud: the person's Webrizen access token, for calls Webrizen makes on their behalf. */
  accessToken?: string;
}

export interface ViewerOrg {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  roles: string[];
  permissions: PermissionSet;
  /**
   * Cloud: permissions come from the member's Operant role, which the API looks up on each
   * request (so role edits apply at once). Unset when the identity layer supplies them.
   */
  useOrgRole?: boolean;
  /** Name of the member's Operant role, once resolved. */
  roleName?: string;
}
